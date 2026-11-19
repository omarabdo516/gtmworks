-- #354: a profile move never leaves an open handover leg unreadable. A leg's Run is read on the profile handovers_due
-- names from the Agent's current row, and nothing else ties an open leg to the profile that started it, so an Agent whose
-- leg is open may not move off that profile until it settles: a target leg whose start was asked for, or whose Run is
-- open, holds the target's move, and a follow-up leg that is starting or running holds the Lead's. Two guards ask it: each
-- Agent's own move (agent_move_blocked, 20261228000000), and the Company-level move that puts imported Agents on the
-- Company's profile (move_company_profile, 20270213000000).
--
-- Additive only: both functions are redefined from their latest definitions, with one more blocker each. No row is
-- rewritten, and the previous app version runs against this: it keeps no handover leg of its own to guard. The table
-- 20261228000000 named conversation_usage is conversation_run_ends since 20270212000000, so the copy names it that.

-- Why an Agent cannot move now, as move_company_profile holds a Company: an open Run in one of its Conversations, a Run
-- reserved for it, an open channel or note Run of it, a message in one of its Conversations in the last five minutes, or a
-- handover leg of it that is open (#354).
create or replace function public.agent_move_blocked(agent uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   where cv.agent_id=agent and m.author='person'
    and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
    and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=m.conversation_id and u.run_id=m.run_id))
  or exists(select 1 from public.conversation_run_reservations r where r.agent_id=agent and r.abandoned_at is null)
  or exists(select 1 from public.channel_runs r where r.agent_id=agent and r.outcome is null)
  or exists(select 1 from public.note_runs r where r.agent_id=agent and r.outcome is null)
  or exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   where cv.agent_id=agent and m.created_at>now()-interval '5 minutes')
  or exists(select 1 from public.agent_handovers h where h.state not in ('done','failed')
   and ((h.to_agent=agent and (h.state='target' or h.state='waiting' and h.target_attempts>0))
    or (h.from_agent=agent and (h.state='follow_up' or h.state='returning' and h.return_attempts>0))));
$$;
revoke all on function public.agent_move_blocked(uuid) from public,anon,authenticated,service_role;

-- 20270213000000's move_company_profile, and an Agent with a handover leg open stays where it is: the leg's Run was
-- started on the profile it has now.
create or replace function public.move_company_profile(c uuid) returns integer language plpgsql security definer set search_path='' as $function$
declare first_owner uuid; movers uuid[]; agent uuid; moved integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if not public.company_profile_ready(c) then return 0; end if;
 select m.person_id into first_owner from public.members m where m.company_id=c and m.role='owner' and m.removed_at is null order by m.person_id limit 1;
 if first_owner is null then return 0; end if;
 movers:=array(select a.id from public.hermes_agents a where a.company_id=c and a.profile<>public.company_engine_profile(c) and a.profile !~ '^ag-[0-9a-f]{32}$');
 if exists(select 1 from public.conversation_run_reservations r where r.agent_id=any(movers) and r.abandoned_at is null)
  or exists(select 1 from public.channel_runs r where r.agent_id=any(movers) and r.outcome is null)
  or exists(select 1 from public.note_runs r where r.agent_id=any(movers) and r.outcome is null)
  or exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   where cv.company_id=c and cv.agent_id=any(movers) and m.created_at>now()-interval '5 minutes')
  or exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   where cv.company_id=c and cv.agent_id=any(movers) and m.author='person'
    and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
    and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=m.conversation_id and u.run_id=m.run_id))
  or exists(select 1 from public.agent_handovers h where h.state not in ('done','failed')
   and ((h.to_agent=any(movers) and (h.state='target' or h.state='waiting' and h.target_attempts>0))
    or (h.from_agent=any(movers) and (h.state='follow_up' or h.state='returning' and h.return_attempts>0)))) then
  return 0;
 end if;
 for agent in update public.hermes_agents set profile=public.company_engine_profile(c),connection_id=gen_random_uuid() where id=any(movers) returning id loop
  perform public.log_agent_event(c,first_owner,null,agent,'MOVE_COMPANY_PROFILE','{}');
  moved:=moved+1;
 end loop;
 return moved;
end $function$;
revoke all on function public.move_company_profile(uuid) from public,anon,authenticated;
grant execute on function public.move_company_profile(uuid) to service_role;
