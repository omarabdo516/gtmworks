-- #764 (spec #759, ADR 0029): a person's message is stored as a turn of its Conversation before its Run starts. Sending
-- is one call, queue_conversation_turn, which checks the person may write, keeps a repeated send key's answer, keeps a
-- note to a person as a note, and otherwise stores the message as the sender's waiting turn, whether or not the Agent
-- is busy: the one starter of turns (lib/conversation-runs.mjs startQueuedTurns, through its claim) then
-- starts its Run, kicked by the request once its answer has gone and by the worker's pass over waiting turns. The claim
-- keeps the two from starting one turn twice. A turn the Engine refused is failed as before ("not sent"), and
-- retry_conversation_turn puts the sender's own failed turn back to waiting: "Try again" makes no second message.
--
-- Additive (ADR 0023): two new functions, nothing taken away or changed. The previous release still sends through
-- reserve_conversation_turn and its direct start, which keep working beside these; a turn either stored stays one turn,
-- since both take the Conversation's lock and answer a key already queued as that same turn.

-- reserve_conversation_turn as 20270220000000 left it, with its reservation branch gone: a message that is not a note,
-- a question's answer or a key already answered is always queued. A key the previous release reserved for a direct
-- start (its start may be in flight) is queued too, so the claim takes its held reservation as a retry with the same
-- key. `open_only` makes the Conversation only, with every check, so a new Conversation's files can be kept before its
-- turn exists and the starter never claims a turn whose images are not yet stored.
create function public.queue_conversation_turn(conversation uuid, c uuid, agent uuid, message_key uuid, message text, open_only boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.conversations; chosen public.hermes_agents; queued public.conversation_queued_turns; noted public.conversation_notes; addressee record; writer text;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if message is null or length(message) not between 0 and 200000 or message_key is null then raise exception 'conversationNotFound' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 select * into existing from public.conversations where id=conversation;
 if found and (existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is distinct from agent) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into chosen from public.hermes_agents where id=agent and company_id=c;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if open_only then
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),agent,chosen.name) on conflict (id) do nothing;
  return jsonb_build_object('state','opened');
 end if;
 -- A send key already answered keeps its answer, before anything is resolved again.
 if exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.send_key=message_key and m.author='person') then
  return jsonb_build_object('state','sent');
 end if;
 select * into noted from public.conversation_notes n where n.conversation_id=conversation and n.send_key=message_key;
 if found then
  if noted.person_id<>auth.uid() then raise exception 'conversationNotFound' using errcode='P0002'; end if;
  return jsonb_build_object('state','note');
 end if;
 select * into queued from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=message_key;
 if found then
  if queued.person_id<>auth.uid() then raise exception 'conversationNotFound' using errcode='P0002'; end if;
  return jsonb_build_object('state',case when queued.failed_at is not null then 'failed' else 'queued' end);
 end if;
 if exists(select 1 from public.reply_cards r where r.conversation_id=conversation and r.kind='question' and r.answer_key=message_key) then
  return jsonb_build_object('state','answered');
 end if;
 select name into writer from public.people where id=auth.uid();
 insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),agent,chosen.name) on conflict (id) do nothing;
 -- A key already reserved for a run is a retry of that run, never a note.
 if not exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key) then
  select * into addressee from public.conversation_addressee(c,message);
  if addressee.person is not null then
   insert into public.conversation_notes(company_id,conversation_id,person_id,author_name,addressed_to,addressed_name,body,send_key)
    values(c,conversation,auth.uid(),coalesce(writer,''),addressee.person,addressee.name,message,message_key) on conflict (conversation_id,send_key) do nothing;
   return jsonb_build_object('state','note');
  end if;
 end if;
 insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message)
  values(conversation,message_key,c,auth.uid(),agent,message) on conflict (conversation_id,send_key) do nothing;
 -- The message is the chat's newest from now (#764): the sidebar lists the chat by it before its Run stores it.
 update public.conversations set last_message_at=now() where id=conversation and last_message_at<now();
 return jsonb_build_object('state','queued');
end $$;
revoke all on function public.queue_conversation_turn(uuid,uuid,uuid,uuid,text,boolean) from public,anon,service_role;
grant execute on function public.queue_conversation_turn(uuid,uuid,uuid,uuid,text,boolean) to authenticated;

-- "Try again" on a message that was not sent: the sender's own failed turn waits again, in its place, with the same send
-- key, so the starter starts it as a first attempt and no second message is made. Only while they may still write, and
-- only a turn no message was stored for. Answers whether it waits again.
create function public.retry_conversation_turn(conversation uuid, c uuid, message_key uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare retried integer;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.send_key=message_key and m.author='person') then return false; end if;
 update public.conversation_queued_turns q set failed_at=null,model_refused=false
  where q.conversation_id=conversation and q.send_key=message_key and q.company_id=c and q.person_id=auth.uid()
   and q.failed_at is not null and q.started_at is null;
 get diagnostics retried=row_count;
 if retried=0 then
  if not exists(select 1 from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=message_key and q.person_id=auth.uid()) then
   raise exception 'conversationNotFound' using errcode='P0002';
  end if;
  return false;
 end if;
 return true;
end $$;
revoke all on function public.retry_conversation_turn(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.retry_conversation_turn(uuid,uuid,uuid) to authenticated;

-- The request's kick and the worker's pass may both claim a turn at the same moment, since a claimed turn stays the
-- first one waiting until its Run is recorded. Only one of them begins its start: begin_turn_start is begin_start
-- (20261211000002) refusing (0) while another attempt of the same key is in flight, begun in the last 30 seconds and
-- neither marked unknown nor handed back as not reached; a start in flight takes at most two tries of ten seconds. The
-- previous release keeps calling begin_start, unchanged.
alter table public.conversation_run_reservations add column start_begun_at timestamptz;
create function public.begin_turn_start(conversation uuid, message_key uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare attempt integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 update public.conversation_run_reservations r set start_attempts=r.start_attempts+1, start_begun_at=now()
  where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null
   and (r.start_begun_at is null or r.start_begun_at<now()-interval '30 seconds' or r.start_unknown_at is not null
    or (r.start_unreached_at is not null and r.start_unreached_at>=r.start_begun_at))
  returning r.start_attempts into attempt;
 return coalesce(attempt,0);
end $$;
revoke all on function public.begin_turn_start(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_turn_start(uuid,uuid) to service_role;
