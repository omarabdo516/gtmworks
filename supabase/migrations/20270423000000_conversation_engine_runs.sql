-- #876 (spec #864, ADR 0033 item 1): a message sent in a Conversation whose messages are the Engine's becomes one Run on
-- its Engine session, and nothing of the message, the reply or a Step is stored here. The row keeps whose it is, its
-- Agent, the session id gtmworks chose for it, and the id of its open Run while one is open (`open_run`), cleared once
-- the Run's end is seen. A nullable column and three new functions: the previous app version reads the table as before.
alter table public.conversations add column open_run text
 constraint conversations_open_run check (open_run is null or open_run ~ '^[A-Za-z0-9_.:-]{1,200}$');
-- Until the spec's other tickets bring a Conversation's questions, requests to act, files, model choice and the rest to
-- the Engine (#877 to #882), a Company's new Conversations start on the Engine only once this is on; off, they keep the
-- old record as today. A Conversation already on the Engine stays there either way. #883 switches the old record off and
-- takes this column with it.
alter table public.companies add column engine_conversations boolean not null default false;

-- A send, checked before any Run starts: the person is an active Member and not a Viewer, the Conversation is theirs, in
-- this Company, and they may talk to its Agent (agent_visible_to, today's rule). A new Conversation's row is written
-- first, on the session id gtmworks chose (`session`, `gtmworks-<uuid>`), and an existing one that has no session yet
-- takes it. A Conversation the old record still holds (a message, a waiting turn or a note in it), a message addressed
-- to a Member, and a Conversation not yet on the Engine in a Company not switched over (engine_conversations) answer `old`: those go on through queue_conversation_turn until #883 switches the old record
-- off. Otherwise the answer is `engine` with the Agent, the session, and the sender's own note, never another Member's.
create or replace function public.open_engine_conversation(c uuid, conversation uuid, agent uuid, session text, message text)
 returns jsonb
 language plpgsql security definer
 set search_path to ''
as $$
declare existing public.conversations; chosen public.hermes_agents; held text;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if conversation is null or session is null or session !~ '^gtmworks-[0-9a-f-]{36}$' or message is null then raise exception 'conversationNotFound' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 select * into existing from public.conversations where id=conversation;
 if found then
  if existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is null then raise exception 'conversationNotFound' using errcode='P0002'; end if;
  agent := existing.agent_id;
 end if;
 select * into chosen from public.hermes_agents where id=agent and company_id=c;
 if not found or not public.agent_visible_to(c,auth.uid(),agent) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 -- A Conversation not yet on the Engine (new, or one with nothing in it yet) moves there only in a Company switched over.
 if (existing.hermes_session_id is null and not coalesce((select o.engine_conversations from public.companies o where o.id=c),false))
  or (select a.person from public.conversation_addressee(c,message) a limit 1) is not null
  or exists(select 1 from public.conversation_messages m where m.conversation_id=conversation)
  or exists(select 1 from public.conversation_queued_turns q where q.conversation_id=conversation)
  or exists(select 1 from public.conversation_notes n where n.conversation_id=conversation) then
  return jsonb_build_object('state','old');
 end if;
 if existing.id is null then
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id,last_message_at)
   values(conversation,c,auth.uid(),agent,chosen.name,session,now());
  held := session;
 else
  update public.conversations set hermes_session_id=coalesce(hermes_session_id,session),last_message_at=greatest(last_message_at,now())
   where id=conversation returning hermes_session_id into held;
 end if;
 return jsonb_build_object('state','engine','agent',agent,'session',held,
  'note',(select n.note from public.member_notes n where n.company_id=c and n.person_id=auth.uid()));
end $$;
revoke all on function public.open_engine_conversation(uuid,uuid,uuid,text,text) from public;
grant all on function public.open_engine_conversation(uuid,uuid,uuid,text,text) to authenticated;

-- The Run the Engine started for the person's message is the Conversation's open Run until its end is seen. Only the
-- Conversation's own person, while they may write in its Company.
create or replace function public.hold_conversation_run(conversation uuid, run text)
 returns boolean
 language sql security definer
 set search_path to ''
as $$
 with held as (
  update public.conversations v set open_run=run
  where v.id=conversation and v.person_id=auth.uid() and public.conversation_can_write(v.company_id) and run ~ '^[A-Za-z0-9_.:-]{1,200}$'
  returning 1)
 select exists(select 1 from held);
$$;
revoke all on function public.hold_conversation_run(uuid,text) from public;
grant all on function public.hold_conversation_run(uuid,text) to authenticated;

-- The end of that Run was seen (it ended, or the Engine no longer knows it): the row no longer holds it. A later Run the
-- row holds by now is left as it is.
create or replace function public.end_conversation_run(conversation uuid, run text)
 returns boolean
 language sql security definer
 set search_path to ''
as $$
 with ended as (
  update public.conversations v set open_run=null
  where v.id=conversation and v.person_id=auth.uid() and v.open_run=run and public.is_member(v.company_id)
  returning 1)
 select exists(select 1 from ended);
$$;
revoke all on function public.end_conversation_run(uuid,text) from public;
grant all on function public.end_conversation_run(uuid,text) to authenticated;
