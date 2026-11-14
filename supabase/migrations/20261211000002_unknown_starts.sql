-- A start whose outcome is unknown (ADR 0015). Hermes may have started the run although its answer was lost, so the
-- reservation is kept until Hermes names the run: it is marked (start_unknown_at) and becomes its sender's own waiting
-- turn, ahead of the turns that waited behind it, so the worker asks again with the same idempotency key, the same body
-- and the same Connection whether or not the person ever sends again. A marked reservation outlives the ten minutes an
-- unrecorded one gets; after a day it is given up and its turn failed, never reserved again on another Connection.
--
-- Additive only: two new columns; the previous app version never records an attempt or marks a start, so its
-- reservations behave as before, and it does not call claim_conversation_turn (whose result gains `retry`).

alter table public.conversation_run_reservations add column start_unknown_at timestamptz, add column start_attempts integer not null default 0;

-- Counted right before the engine is called, so a crash between the call and its answer never loses the run: an
-- attempted start left unrecorded after ten minutes is marked unknown by the worker (abandon_conversation_reservations)
-- instead of abandoned. Returns the attempt's number; only attempt 1 can be refused by the engine, every later one (after
-- a stop, a second claimer or the person's resend) is a retry. 0: the reservation is no longer active (nothing starts).
create function public.begin_start(conversation uuid, message_key uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare attempt integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 update public.conversation_run_reservations r set start_attempts=r.start_attempts+1
  where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null returning r.start_attempts into attempt;
 return coalesce(attempt,0);
end $$;
revoke all on function public.begin_start(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_start(uuid,uuid) to service_role;

-- Marks one active reservation's start unknown and makes it its sender's waiting turn, ahead of the turns that waited
-- behind it. The caller holds the agents lock (the lock of every reservation change); no Conversation lock is taken,
-- so the worker can mark several under the one lock without inverting the lock order of reserve_conversation_turn.
create function public.queue_unknown_start(held public.conversation_run_reservations) returns void
language plpgsql security definer set search_path='' as $$
declare chosen public.hermes_agents;
begin
 update public.conversation_run_reservations r set start_unknown_at=coalesce(r.start_unknown_at,now()) where r.conversation_id=held.conversation_id and r.send_key=held.send_key;
 select * into chosen from public.hermes_agents a where a.id=held.agent_id and a.company_id=held.company_id;
 if chosen.id is not null and held.message is not null then
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(held.conversation_id,held.company_id,held.person_id,held.agent_id,chosen.name) on conflict (id) do nothing;
  insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message,queued_at)
   values(held.conversation_id,held.send_key,held.company_id,held.person_id,held.agent_id,held.message,held.created_at) on conflict (conversation_id,send_key) do nothing;
 end if;
end $$;
revoke all on function public.queue_unknown_start(public.conversation_run_reservations) from public,anon,authenticated,service_role;

create function public.keep_unknown_start(conversation uuid, message_key uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare held public.conversation_run_reservations;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null;
 if not found then return false; end if;
 perform public.queue_unknown_start(held);
 return true;
end $$;
revoke all on function public.keep_unknown_start(uuid,uuid) from public,anon,authenticated;
grant execute on function public.keep_unknown_start(uuid,uuid) to service_role;

-- As before, and: the turn that holds its own active reservation goes first (it may already be running), and the
-- result says whether its start was already attempted or marked unknown, so the driver asks again as a retry that no
-- answer but a run id settles.
drop function public.claim_conversation_turn(uuid);
create function public.claim_conversation_turn(conversation uuid)
returns table(company uuid, agent uuid, person uuid, send_key uuid, message text, connection uuid, note text, retry boolean)
language plpgsql security definer set search_path='' as $$
declare turn public.conversation_queued_turns; linked public.hermes_connections; held public.conversation_run_reservations; uncertain boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 if exists(select 1 from public.conversation_open_run(conversation)) then return; end if;
 select q.* into turn from public.conversation_queued_turns q where q.conversation_id=conversation and q.started_at is null and q.failed_at is null
  order by exists(select 1 from public.conversation_run_reservations r where r.conversation_id=q.conversation_id and r.send_key=q.send_key and r.abandoned_at is null) desc,q.queued_at,q.send_key limit 1;
 if not found then return; end if;
 -- Its message was recorded meanwhile (the direct send's late record of a start once marked unknown): it already ran.
 if exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.send_key=turn.send_key and m.author='person') then
  perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
  update public.conversation_queued_turns q set started_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key;
  delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=turn.send_key and r.abandoned_at is null;
  return;
 end if;
 if exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.abandoned_at is null and r.send_key<>turn.send_key) then return; end if;
 if not exists(select 1 from public.members m where m.company_id=turn.company_id and m.person_id=turn.person_id and m.removed_at is null and m.role<>'viewer')
  or not exists(select 1 from public.conversations cv where cv.id=conversation and cv.agent_id=turn.agent_id) then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=turn.send_key and r.abandoned_at is null;
 uncertain:=held.conversation_id is not null and (held.start_unknown_at is not null or held.start_attempts>0);
 if held.conversation_id is not null then select * into linked from public.hermes_connections h where h.id=held.connection_id;
 else select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=turn.agent_id and a.company_id=turn.company_id;
 end if;
 -- A start that may have happened is never failed here: it waits for its own Connection to be usable again.
 if (linked.id is null or (linked.profile ~ '^co-[0-9a-f]{32}$' and linked.profile<>public.company_engine_profile(turn.company_id))) and not uncertain then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 if linked.id is null then return; end if;
 if linked.profile ~ '^co-[0-9a-f]{32}$' and not public.company_profile_ready(turn.company_id) and not uncertain then return; end if;
 if held.conversation_id is null then
  insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
   values(conversation,turn.send_key,turn.company_id,linked.id,turn.person_id,turn.agent_id,turn.message,linked.profile)
   on conflict on constraint conversation_run_reservations_pkey do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null,
    start_attempts=0,start_unknown_at=null
    where public.conversation_run_reservations.abandoned_at is not null;
 end if;
 return query select turn.company_id,turn.agent_id,turn.person_id,turn.send_key,turn.message,linked.id,
  public.pinned_run_note(conversation,turn.send_key,turn.company_id,turn.person_id),uncertain;
end $$;
revoke all on function public.claim_conversation_turn(uuid) from public,anon,authenticated;
grant execute on function public.claim_conversation_turn(uuid) to service_role;

-- As before (the Agent gone, the sender no longer able to write), and: an attempted start left unrecorded for ten
-- minutes is marked unknown and kept as its sender's turn, not abandoned (the engine may have started it); an
-- unattempted one is abandoned after ten minutes as before; a marked start gets a day, and when given up its turn is
-- failed, so it is never reserved again on another Connection (its sender sees it was not sent).
create or replace function public.abandon_conversation_reservations() returns integer language plpgsql security definer set search_path='' as $$
declare abandoned integer; stale public.conversation_run_reservations;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 for stale in select r.* from public.conversation_run_reservations r
  where r.abandoned_at is null and r.start_unknown_at is null and r.start_attempts>0 and r.created_at<now()-interval '10 minutes'
   and exists(select 1 from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id)
   and exists(select 1 from public.members m where m.company_id=r.company_id and m.person_id=r.person_id and m.removed_at is null and m.role<>'viewer')
 loop perform public.queue_unknown_start(stale); end loop;
 with given_up as (
  update public.conversation_run_reservations r set abandoned_at=now()
  where r.abandoned_at is null and ((r.start_unknown_at is null and r.start_attempts=0 and r.created_at<now()-interval '10 minutes')
   or r.start_unknown_at<now()-interval '1 day'
   or not exists(select 1 from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id)
   or not exists(select 1 from public.members m where m.company_id=r.company_id and m.person_id=r.person_id and m.removed_at is null and m.role<>'viewer'))
  returning r.conversation_id,r.send_key,r.start_unknown_at
 ), failed as (
  update public.conversation_queued_turns q set failed_at=now() from given_up g
  where g.start_unknown_at is not null and q.conversation_id=g.conversation_id and q.send_key=g.send_key and q.started_at is null and q.failed_at is null
 )
 select count(*)::int into abandoned from given_up;
 return abandoned;
end $$;
revoke all on function public.abandon_conversation_reservations() from public,anon,authenticated;
grant execute on function public.abandon_conversation_reservations() to service_role;

-- A refusal fails or releases only the attempt it answers, and only while no later attempt was made and the start was
-- not marked unknown: a second claimer's or a resend's attempt may hold a run, and a refusal proves nothing about it.
-- `attempt` 0 is a failure before any attempt (no usable Connection). Otherwise as before.
create function public.fail_conversation_turn(conversation uuid, message_key uuid, attempt integer) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null
  and (r.start_unknown_at is not null or r.start_attempts<>attempt)) then return; end if;
 update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=message_key and q.started_at is null;
 delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null;
end $$;
revoke all on function public.fail_conversation_turn(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.fail_conversation_turn(uuid,uuid,integer) to service_role;

-- The two-argument form is the failure before any attempt (no usable Connection): it fails only a turn nobody attempted.
create or replace function public.fail_conversation_turn(conversation uuid, message_key uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.fail_conversation_turn(conversation,message_key,0);
end $$;
revoke all on function public.fail_conversation_turn(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_conversation_turn(uuid,uuid) to service_role;

create function public.release_conversation_run(conversation uuid, c uuid, message_key uuid, attempt integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare released integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 update public.conversation_run_reservations r set abandoned_at=now()
  where r.conversation_id=conversation and r.send_key=message_key and r.company_id=c and r.person_id=auth.uid() and r.abandoned_at is null
   and r.start_unknown_at is null and r.start_attempts=attempt;
 get diagnostics released=row_count;
 return released>0;
end $$;
revoke all on function public.release_conversation_run(uuid,uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.release_conversation_run(uuid,uuid,uuid,integer) to authenticated;

-- The previous app version's form: it never counts an attempt, so it releases only a reservation nobody attempted.
create or replace function public.release_conversation_run(conversation uuid, c uuid, message_key uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare released integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 update public.conversation_run_reservations r set abandoned_at=now()
  where r.conversation_id=conversation and r.send_key=message_key and r.company_id=c and r.person_id=auth.uid() and r.abandoned_at is null
   and r.start_unknown_at is null and r.start_attempts=0;
 get diagnostics released=row_count;
 return released>0;
end $$;
revoke all on function public.release_conversation_run(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.release_conversation_run(uuid,uuid,uuid) to authenticated;

-- As before, and: a turn whose message the direct send already stored is started, not failed.
create or replace function public.record_conversation_turn(conversation uuid, message_key uuid, run text, started_on uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare turn public.conversation_queued_turns; held public.conversation_run_reservations; chosen public.hermes_agents; writer text; saved bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into turn from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=message_key;
 if not found or run is null then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if turn.started_at is not null then return false; end if;
 -- Its message was already stored by the direct send's late record: the turn ran; it is started, never failed.
 if exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.send_key=message_key and m.author='person') then
  update public.conversation_queued_turns q set started_at=now() where q.conversation_id=conversation and q.send_key=message_key;
  delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null;
  return false;
 end if;
 select * into chosen from public.hermes_agents a where a.id=turn.agent_id and a.company_id=turn.company_id;
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key;
 if chosen.id is null or held.conversation_id is null or held.abandoned_at is not null or started_on is null or held.connection_id<>started_on or held.connection_id is distinct from chosen.connection_id then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=message_key;
  delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null;
  return false;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation_run:'||run,0));
 if exists(select 1 from public.conversation_messages m where m.author='person' and m.run_id=run and m.conversation_id<>conversation) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select name into writer from public.people where id=turn.person_id;
 insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
  values(turn.company_id,conversation,'person',turn.person_id,coalesce(writer,''),turn.message,message_key,run) on conflict do nothing returning id into saved;
 delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key;
 update public.conversation_queued_turns q set started_at=now() where q.conversation_id=conversation and q.send_key=message_key;
 return saved is not null;
end $$;
revoke all on function public.record_conversation_turn(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.record_conversation_turn(uuid,uuid,text,uuid) to service_role;

-- As before, and: a reservation reserved again after it was abandoned (a refused first attempt released, an unattempted
-- one after ten minutes, a marked one given up after a day) starts its attempts anew, so its next start is a first
-- start the engine may refuse.
create or replace function public.reserve_conversation_run(conversation uuid, c uuid, agent uuid, message_key uuid, message text) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing public.conversations; held public.conversation_run_reservations; linked public.hermes_connections;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if message is null or length(message) not between 1 and 200000 then raise exception 'conversationNotFound' using errcode='22023'; end if;
 select * into existing from public.conversations where id=conversation;
 if found and (existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is distinct from agent) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key;
 if found and (held.person_id<>auth.uid() or held.company_id<>c or held.agent_id is distinct from agent) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 -- A retry keeps the Connection it first reserved, so it never starts a run on another profile; an abandoned one is
 -- reserved again on the Agent's Connection of now. Either way the checks below run before it is returned.
 if found and held.abandoned_at is null then select * into linked from public.hermes_connections where id=held.connection_id;
 else select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=agent and a.company_id=c;
 end if;
 if linked.id is null then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if linked.profile ~ '^co-[0-9a-f]{32}$' then
  if linked.profile<>public.company_engine_profile(c) then raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
  if not public.company_profile_ready(c) then raise exception 'agentLevelPending' using errcode='55000'; end if;
 end if;
 insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
  values(conversation,message_key,c,linked.id,auth.uid(),agent,message,linked.profile)
  on conflict (conversation_id,send_key) do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null,
   start_attempts=0,start_unknown_at=null
   where public.conversation_run_reservations.abandoned_at is not null;
 return linked.id;
end $$;
revoke all on function public.reserve_conversation_run(uuid,uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.reserve_conversation_run(uuid,uuid,uuid,uuid,text) to authenticated;
