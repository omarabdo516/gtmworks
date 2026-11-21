-- #31: an Agent's Routines are the cron jobs of its own Engine profile (ADR 0016, decision of 2026-11-16), so the Engine
-- keeps and runs them and gtmworks keeps no copy. Who may change one, and the log of each change, stay in gtmworks:
-- check_routine_change is asked before the Engine is changed (an active Owner or Manager of the Company, and an Agent of
-- that Company), and log_routine_change records one row of the Company log once the Engine holds the change, naming
-- the person, the Agent, the Routine's name and, for a new or changed schedule, the schedule. A Contributor or a Viewer
-- reads the Routines of the Agents shown to them and changes none.

-- The Agent's log row carries the Routine, its schedule and the change's own key too; every other key is as
-- 20270227000000 keeps it.
create or replace function public.log_agent_event(c uuid, actor uuid, actor_name text, agent uuid, act text, details jsonb)
 returns void language sql security definer set search_path='' as $$
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,actor,public.log_actor_kind(c,actor),coalesce(actor_name,(select name from public.people where id=actor)),
   'agent',agent,public.log_agent_action(act),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=agent),'replacement_id',details->'replacement_id','job',details->'job','rule',details->'rule','taught_by',details->'taught_by','asked_for',details->'asked_for','asked_by',details->'asked_by','reason',details->'reason','private',details->'private','teller',details->'teller','skill',details->'skill','setting',details->'setting','old',details->'old','new',details->'new','routine',details->'routine','schedule',details->'schedule','change',details->'change')),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
$$;
revoke all on function public.log_agent_event(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated,service_role;

-- The check is asked with the whole row the log will hold, before the Engine is changed: the Role, an Agent of the
-- Company, and a row the log accepts. The name is the Routine's own (at most 200 characters, never a credential), and a
-- schedule is a five-field cron expression of plain numbers, as Settings writes it, given exactly for a new or changed
-- schedule. Once the Engine holds the change only an outage can keep its row from being written.
create function public.check_routine_change(c uuid, agent uuid, act text, routine text, schedule text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_manage_company(c) or not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c)
  then raise exception 'routineNotAllowed' using errcode='42501'; end if;
 if act is null or act not in ('routine_created','routine_changed','routine_paused','routine_resumed','routine_run','routine_deleted')
  or routine is null or length(routine)>200 or public.secret_like(routine)
  or (schedule is not null and schedule !~ '^[0-9*,/-]{1,20}( [0-9*,/-]{1,20}){4}$')
  or ((schedule is null) = (act in ('routine_created','routine_changed')))
  then raise exception 'routineInvalid' using errcode='22023'; end if;
end $$;
revoke all on function public.check_routine_change(uuid,uuid,text,text,text) from public,anon,service_role;
grant execute on function public.check_routine_change(uuid,uuid,text,text,text) to authenticated;

-- One change as one row on the Agent, checked again as above. `change` is the key the app gave this one change: a write
-- tried again after an answer was lost finds the row the first try wrote and writes nothing, so a change is one row.
create function public.log_routine_change(c uuid, agent uuid, act text, routine text, schedule text, change uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_routine_change(c,agent,act,routine,schedule);
 if change is null then raise exception 'routineInvalid' using errcode='22023'; end if;
 if exists(select 1 from public.company_log l where l.company_id=c and l.agent_id=agent and l.action=act and l.details->>'change'=change::text) then return; end if;
 perform public.log_agent_event(c,auth.uid(),null,agent,act,jsonb_build_object('routine',routine,'schedule',schedule,'change',change));
end $$;
revoke all on function public.log_routine_change(uuid,uuid,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.log_routine_change(uuid,uuid,text,text,text,uuid) to authenticated;
