-- #876 (spec #864, ADR 0033 item 1): a message sent in a Conversation whose messages are the Engine's becomes one Run on
-- its Engine session, and nothing of the message, the reply or a Step is stored here. The row keeps whose it is, its
-- Agent, the session id gtmworks chose for it, and the ids of its open Runs in the order they were started (`open_runs`,
-- the Engine queues them on the session in that order), each let go once its end is seen. A nullable column and three new functions: the previous app version reads the table as before.
alter table public.conversations add column open_runs text[] not null default '{}'
 constraint conversations_open_runs check (cardinality(open_runs)<=32 and array_to_string(open_runs,',') ~ '^([A-Za-z0-9_.:-]{1,200}(,|$))*$');
-- Until the spec's other tickets bring a Conversation's questions, requests to act, files, model choice and the rest to
-- the Engine (#877 to #882), a Company's new Conversations start on the Engine only once this is on; off, they keep the
-- old record as today. A Conversation already on the Engine stays there either way. #883 switches the old record off and
-- takes this column with it.
alter table public.companies add column engine_conversations boolean not null default false;

-- A send, checked before any Run starts: the person is an active Member and not a Viewer, the Conversation is theirs, in
-- this Company, and they may talk to its Agent (agent_visible_to, today's rule). A new Conversation's row is written
-- first, on the session id gtmworks chose (`session`, `gtmworks-<uuid>`). A Conversation not made on the Engine, a new one
-- in a Company not switched over (engine_conversations), and a new one whose message is addressed to a Member answer `old`: those go on through queue_conversation_turn until #883 switches the old record
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
 if existing.id is null then
  -- A new Conversation starts on the Engine only in a Company switched over, and a message addressed to a Member is kept
  -- as a note on the old record, as today.
  if not coalesce((select o.engine_conversations from public.companies o where o.id=c),false)
   or (select a.person from public.conversation_addressee(c,message) a limit 1) is not null then
   return jsonb_build_object('state','old');
  end if;
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id,last_message_at)
   values(conversation,c,auth.uid(),agent,chosen.name,session,now());
  held := session;
 else
  -- Only a Conversation this path made is on the Engine: it has its session and nothing on the old record. Any other
  -- (one the old record holds, or a row made without a session, such as the Owner's empty first Conversation) stays there.
  if existing.hermes_session_id is null
   or exists(select 1 from public.conversation_messages m where m.conversation_id=conversation)
   or exists(select 1 from public.conversation_queued_turns q where q.conversation_id=conversation)
   or exists(select 1 from public.conversation_notes n where n.conversation_id=conversation) then
   return jsonb_build_object('state','old');
  end if;
  -- A note to a Member has no place in an Engine session: it is refused, and the words stay in the box.
  if (select a.person from public.conversation_addressee(c,message) a limit 1) is not null then
   raise exception 'conversationAddressedOnEngine' using errcode='22023';
  end if;
  -- Writing in an archived Conversation brings it back, logged as the person's, as on the old record.
  update public.conversations set last_message_at=greatest(last_message_at,now()),archived_at=null,archived_by=null
   where id=conversation returning hermes_session_id into held;
  if existing.archived_at is not null then perform public.log_conversation_archive(conversation,false,auth.uid()); end if;
 end if;
 return jsonb_build_object('state','engine','agent',agent,'session',held,
  'note',(select n.note from public.member_notes n where n.company_id=c and n.person_id=auth.uid()));
end $$;
revoke all on function public.open_engine_conversation(uuid,uuid,uuid,text,text) from public;
grant all on function public.open_engine_conversation(uuid,uuid,uuid,text,text) to authenticated;

-- The Run the Engine started for the person's message joins the Conversation's open Runs, after the ones started before
-- it, until its end is seen; the same Run held again keeps its place. Only the
-- server holds it, right after the Engine answered the start it made (lib/conversation-send.ts), for the Conversation's
-- own person while they may write in its Company: no browser names a Run for the row to hold, so the live read follows
-- only a Run this Conversation's own send started.
create or replace function public.hold_conversation_run(conversation uuid, person uuid, run text)
 returns boolean
 language sql security definer
 set search_path to ''
as $$
 with held as (
  update public.conversations v set open_runs=case when run=any(v.open_runs) then v.open_runs else v.open_runs||run end
  where v.id=conversation and v.person_id=person and run ~ '^[A-Za-z0-9_.:-]{1,200}$' and (run=any(v.open_runs) or cardinality(v.open_runs)<32)
   and exists(select 1 from public.members m where m.company_id=v.company_id and m.person_id=person and m.removed_at is null and m.role<>'viewer')
  returning 1)
 select exists(select 1 from held);
$$;
revoke all on function public.hold_conversation_run(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.hold_conversation_run(uuid,uuid,text) to service_role;

-- The end of that Run was seen (it ended, or the Engine no longer knows it): the row no longer holds it. The other Runs
-- it holds stay, in their order.
create or replace function public.end_conversation_run(conversation uuid, run text)
 returns boolean
 language sql security definer
 set search_path to ''
as $$
 with ended as (
  update public.conversations v set open_runs=array_remove(v.open_runs,run)
  where v.id=conversation and v.person_id=auth.uid() and run=any(v.open_runs) and public.is_member(v.company_id)
  returning 1)
 select exists(select 1 from ended);
$$;
revoke all on function public.end_conversation_run(uuid,text) from public;
grant all on function public.end_conversation_run(uuid,text) to authenticated;
