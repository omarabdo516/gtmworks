-- #514: a queued Conversation turn's start, or a handover leg's, that never reached an Engine (nothing could connect: the
-- Engine is not running, or there is none to send it to) is no attempt, as a channel or note Run's is since #413.
-- begin_start and begin_handover count an attempt before the Engine is known, so a request that may reach it keeps its
-- idempotency; the worker hands the attempt back here once it knows the request never left. Only the attempt that was
-- begun is handed back: once a later attempt began, the start was marked unknown, a run id was recorded or the turn or
-- leg ended, nothing changes, since that later request may have reached the Engine. The previous app version never
-- calls either function.

-- A queued turn handed back stays due on its reservation as never started, so its next start is a first one and a
-- refusal of it fails the turn (or refuses its model) instead of reading as unknown for a day. The reservation notes
-- that it was handed back, and the ten minutes an unstarted reservation lives still end it: the worker then fails the
-- turn, so its sender sees it was not sent, instead of reserving it again with fresh minutes while the Engine stays down.
alter table public.conversation_run_reservations add column start_unreached_at timestamptz;

create function public.release_queued_start(conversation uuid, message_key uuid, attempt integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare released integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if attempt is null or attempt < 1 then return false; end if;
 update public.conversation_run_reservations r set start_attempts=r.start_attempts-1, start_unreached_at=now()
  where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null
   and r.start_unknown_at is null and r.start_attempts=attempt;
 get diagnostics released=row_count;
 return released>0;
end $$;
revoke all on function public.release_queued_start(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.release_queued_start(uuid,uuid,integer) to service_role;

-- 20261211000002's abandoning, unchanged but for its last step: a given-up reservation whose start was handed back as
-- never reached fails its queued turn, as one whose start was lost for a day does. A reservation made again for the
-- same key (reserve_conversation_turn, claim_conversation_turn) starts its minutes anew, so a mark older than it is not
-- its own.
-- While the Engine stays down each pass begins an attempt and hands it back, so the attempt this sees in flight on a
-- reservation handed back within the last minute is that pass's, not a lost start: it is not marked unknown (which would
-- turn the ten minutes into a day), and the next run of this, a minute on, gives the reservation up or, if the attempt
-- is still counted then, marks it as before.
create or replace function public.abandon_conversation_reservations() returns integer language plpgsql security definer set search_path='' as $$
declare abandoned integer; stale public.conversation_run_reservations;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 for stale in select r.* from public.conversation_run_reservations r
  where r.abandoned_at is null and r.start_unknown_at is null and r.start_attempts>0 and r.created_at<now()-interval '10 minutes'
   and not coalesce(r.start_unreached_at>=r.created_at and r.start_unreached_at>now()-interval '1 minute',false)
   and exists(select 1 from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id)
   and exists(select 1 from public.members m where m.company_id=r.company_id and m.person_id=r.person_id and m.removed_at is null and m.role<>'viewer')
 loop perform public.queue_unknown_start(stale); end loop;
 with given_up as (
  update public.conversation_run_reservations r set abandoned_at=now()
  where r.abandoned_at is null and ((r.start_unknown_at is null and r.start_attempts=0 and r.created_at<now()-interval '10 minutes')
   or r.start_unknown_at<now()-interval '1 day'
   or not exists(select 1 from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id)
   or not exists(select 1 from public.members m where m.company_id=r.company_id and m.person_id=r.person_id and m.removed_at is null and m.role<>'viewer'))
  returning r.conversation_id,r.send_key,r.start_unknown_at,r.start_unreached_at>=r.created_at as unreached
 ), failed as (
  update public.conversation_queued_turns q set failed_at=now() from given_up g
  where (g.start_unknown_at is not null or g.unreached)
   and q.conversation_id=g.conversation_id and q.send_key=g.send_key and q.started_at is null and q.failed_at is null
 )
 select count(*)::int into abandoned from given_up;
 return abandoned;
end $$;

-- A handover leg handed back stays due as never started: its next start is a first attempt, so a refusal of it ends the
-- leg as failed, and a waiting leg's ten minutes (or the answer's and the follow-up's day) still end it. The leg is
-- named, so an attempt of another leg is never handed back; the 30 seconds between starts stay. A leg Stop marked while
-- this start was on its way (#478, stop_requested_at) waited only for the start's answer: none reached an Engine, so it
-- ends as stopped now, with no Run to stop, instead of starting again after Stop.
create function public.release_handover_start(h bigint, attempt integer, leg text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers;
begin
 select * into r from public.agent_handovers where id=h for update;
 if r.id is null or leg is null or r.state is distinct from leg or attempt is null or attempt < 1 then return false; end if;
 if not ((r.state='waiting' and r.target_run is null and r.target_attempts=attempt)
  or (r.state='handing' and r.answer_run is null and r.answer_attempts=attempt)
  or (r.state='returning' and r.follow_up_run is null and r.return_attempts=attempt)) then return false; end if;
 if r.stop_requested_at is not null then perform public.end_handovers_stopped(array[h]); return true; end if;
 update public.agent_handovers set
  target_attempts=target_attempts-case when r.state='waiting' then 1 else 0 end,
  answer_attempts=answer_attempts-case when r.state='handing' then 1 else 0 end,
  return_attempts=return_attempts-case when r.state='returning' then 1 else 0 end
 where id=h;
 return true;
end $$;
revoke all on function public.release_handover_start(bigint,integer,text) from public,anon,authenticated;
grant execute on function public.release_handover_start(bigint,integer,text) to service_role;
