-- #425, ADR 0016: the main Agent on the Company's `co-<company id>` profile is configurable like every Agent. That profile
-- is its own (it is the profile's keeper, company_profile_keeper), so its model, learning mode and sub-agents switch are
-- remembered with the profile's own record, company_profiles, as an `ag-` Agent's are with agent_profiles. Until now only
-- an agent_profiles row made an Agent choosable, and the main Agent has none (its generated profile name would be an
-- `ag-` one), so every per-Agent control refused it as shared.
--
-- Additive: three columns that start empty (no choice, sub-agents off), so every existing main Agent becomes choosable
-- and keeps following the Company until its Owner chooses. No profile, memory, session or sign-in is touched. The
-- previous app version reads the functions by column name and calls record_company_profile with four arguments, which
-- the new fifth one (optional) still takes.

alter table public.company_profiles add column model_choice text, add column subagents boolean not null default false,
 add column learning_mode_choice text;
alter table public.company_profiles add constraint company_profiles_model_choice_shape
 check (model_choice is null or model_choice ~ '^[a-z0-9][a-z0-9._-]{0,63}/[^[:space:]/][^[:space:]]{0,199}$');
alter table public.company_profiles add constraint company_profiles_learning_mode_choice_shape
 check (learning_mode_choice is null or learning_mode_choice in ('auto','ask'));

-- Whether the Agent is the keeper of its Company's profile and runs on it: its choices are the profile record's.
create function public.is_profile_keeper(c uuid, agent uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c and a.profile=public.company_engine_profile(c))
  and agent=public.company_profile_keeper(c);
$$;
revoke all on function public.is_profile_keeper(uuid,uuid) from public,anon,authenticated,service_role;

-- #29's rows, with the keeper choosable and its choices read from the Company profile's record. An Agent with a record of
-- its own is read from that record, as the writers below write it there first; one the worker is still moving (its record
-- exists, it still names the `co-` profile) stays unchoosable, as before.
create or replace function public.company_agent_models(c uuid)
returns table(agent uuid, name text, profile text, own boolean, choosable boolean, model_choice text, subagents boolean)
language sql stable security definer set search_path='' as $$
 select a.id,a.name,a.profile,
  public.is_profile_keeper(c,a.id) or exists(select 1 from public.agent_profiles ap where ap.agent_id=a.id and ap.company_id=c and ap.profile=a.profile),
  case when g.agent_id is not null then g.profile=a.profile else public.is_profile_keeper(c,a.id) end,
  case when g.agent_id is not null then g.model_choice when public.is_profile_keeper(c,a.id) then p.model_choice end,
  case when g.agent_id is not null then g.subagents when public.is_profile_keeper(c,a.id) then p.subagents else false end
 from public.hermes_agents a
  join public.company_profiles p on p.company_id=c
  left join public.agent_profiles g on g.agent_id=a.id and g.company_id=c
 where a.company_id=c and public.can_see_agent(c,a.id)
  and (a.profile=p.profile or a.profile=public.agent_engine_profile(a.id))
 order by a.is_default desc,a.name,a.id;
$$;

create or replace function public.company_learning_modes(c uuid)
returns table(agent uuid, learning_mode_choice text)
language sql stable security definer set search_path='' as $$
 select a.id,case when g.agent_id is not null then g.learning_mode_choice when public.is_profile_keeper(c,a.id) then p.learning_mode_choice end
 from public.hermes_agents a
  left join public.agent_profiles g on g.agent_id=a.id and g.company_id=c
  left join public.company_profiles p on p.company_id=c
 where a.company_id=c and public.can_see_agent(c,a.id)
 order by a.is_default desc,a.name,a.id;
$$;

-- The three writers: an Agent with its own record as before, else the keeper on the Company profile; any other Agent on
-- that profile shares it and is refused.
create or replace function public.set_agent_model(agent uuid, model text) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 if model is not null and model !~ '^[a-z0-9][a-z0-9._-]{0,63}/[^[:space:]/][^[:space:]]{0,199}$' then
  raise exception 'settingInvalid' using errcode='22023'; end if;
 select a.company_id into c from public.hermes_agents a where a.id=set_agent_model.agent;
 if c is null then raise exception 'settingAgentUnknown' using errcode='P0002'; end if;
 if not public.is_company_owner(c) then raise exception 'settingNotAllowed' using errcode='42501'; end if;
 update public.agent_profiles p set model_choice=set_agent_model.model where p.agent_id=set_agent_model.agent and p.company_id=c;
 if found then return; end if;
 update public.company_profiles p set model_choice=set_agent_model.model where p.company_id=c and public.is_profile_keeper(c,set_agent_model.agent);
 if not found then raise exception 'settingAgentShared' using errcode='42501'; end if;
end $$;

-- The Company profile is marked as changing before anything is written, as an Agent's own is, so no Run starts on it until
-- the worker wrote the toolset and its read-back was recorded.
create or replace function public.set_agent_subagents(agent uuid, enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 if enabled is null then raise exception 'settingInvalid' using errcode='22023'; end if;
 select a.company_id into c from public.hermes_agents a where a.id=set_agent_subagents.agent;
 if c is null then raise exception 'settingAgentUnknown' using errcode='P0002'; end if;
 if not public.is_company_owner(c) then raise exception 'settingNotAllowed' using errcode='42501'; end if;
 update public.agent_profiles p set subagents=set_agent_subagents.enabled,tools_pending=true where p.agent_id=set_agent_subagents.agent and p.company_id=c;
 if found then return; end if;
 update public.company_profiles p set subagents=set_agent_subagents.enabled,tools_pending=true where p.company_id=c and public.is_profile_keeper(c,set_agent_subagents.agent);
 if not found then raise exception 'settingAgentShared' using errcode='42501'; end if;
end $$;

create or replace function public.set_agent_learning_mode(agent uuid, mode text) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 if mode is not null and mode not in ('auto','ask') then raise exception 'learningModeInvalid' using errcode='22023'; end if;
 select a.company_id into c from public.hermes_agents a where a.id=set_agent_learning_mode.agent;
 if c is null then raise exception 'settingAgentUnknown' using errcode='P0002'; end if;
 if not public.is_company_owner(c) then raise exception 'settingNotAllowed' using errcode='42501'; end if;
 update public.agent_profiles p set learning_mode_choice=set_agent_learning_mode.mode where p.agent_id=set_agent_learning_mode.agent and p.company_id=c;
 if found then return; end if;
 update public.company_profiles p set learning_mode_choice=set_agent_learning_mode.mode where p.company_id=c and public.is_profile_keeper(c,set_agent_learning_mode.agent);
 if not found then raise exception 'settingAgentShared' using errcode='42501'; end if;
end $$;

-- The worker's list of Company profiles now carries the main Agent's sub-agents switch, so it writes the Company profile's
-- tools with the delegation variant when it is on (lib/company-profiles.mjs). The body is 20270213000000's; the return
-- type changed, so the function is made again with its grants.
drop function public.company_profile_work();
create function public.company_profile_work()
 returns table(company_id uuid, profile text, agent_level smallint, tools_level smallint, tools_policy integer, tools_pending boolean, attach boolean, move boolean, subagents boolean)
 language sql stable security definer set search_path='' as $function$
 select w.id,public.company_engine_profile(w.id),w.agent_level,w.tools_level,w.tools_policy,coalesce(w.tools_pending,false),w.attach,w.move,coalesce(w.subagents,false) from (
  select c.id,c.agent_level,p.tools_level,p.tools_policy,p.tools_pending,p.subagents,p.company_id is not null as recorded,
   p.company_id is null and exists(select 1 from public.hermes_agents a where a.company_id=c.id and a.profile=public.company_engine_profile(c.id)) as lost,
   not exists(select 1 from public.hermes_agents a where a.company_id=c.id) as attach,
   exists(select 1 from public.hermes_agents a where a.company_id=c.id and a.profile<>public.company_engine_profile(c.id) and a.profile !~ '^ag-[0-9a-f]{32}$') as move
  from public.companies c left join public.company_profiles p on p.company_id=c.id
  where exists(select 1 from public.members m where m.company_id=c.id and m.role='owner' and m.removed_at is null)) w
 where w.attach or w.move or w.lost
  or (w.recorded and (w.tools_level<>w.agent_level or w.tools_policy is distinct from public.engine_tool_policy() or w.tools_pending))
 -- A company that only waits to move may wait long (for its own sign-in): those come after every company with other work,
 -- in an order that turns every minute, so a hundred of them never hold back a company to provision, nor each other.
 order by (w.move and not w.attach and not w.lost and not (w.recorded and (w.tools_level<>w.agent_level or w.tools_policy is distinct from public.engine_tool_policy() or w.tools_pending))),
  case when w.move and not w.attach and not w.lost then md5(w.id::text||date_trunc('minute',now())::text) end,w.id
 limit 100;
$function$;
revoke all on function public.company_profile_work() from public,anon,authenticated;
grant execute on function public.company_profile_work() to service_role;

-- The read-back of the Company profile's tools names the switch the worker wrote, as record_agent_profile does: a change
-- the Owner made while it wrote is never recorded as applied, and the profile stays pending.
drop function public.record_company_profile(uuid,text,integer,integer);
create function public.record_company_profile(c uuid, engine_profile text, level integer, policy integer, subagents_written boolean default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if engine_profile is distinct from public.company_engine_profile(c) or level is null or level not between 1 and 3 or policy is distinct from public.engine_tool_policy() then
  raise exception 'companyProfileInvalid' using errcode='22023'; end if;
 if subagents_written is not null and exists(select 1 from public.company_profiles p where p.company_id=c and p.subagents is distinct from subagents_written) then
  raise exception 'companyProfileChanged' using errcode='40001'; end if;
 insert into public.company_profiles(company_id,profile,tools_level,tools_policy,tools_pending) values (c,engine_profile,level,policy,false)
  on conflict (company_id) do update set tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
end $$;
revoke all on function public.record_company_profile(uuid,text,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.record_company_profile(uuid,text,integer,integer,boolean) to service_role;
