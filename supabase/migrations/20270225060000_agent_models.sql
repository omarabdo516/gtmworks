-- #29: the Company's default model and each Agent's own, and sub-agents off until the Owner turns them on for one Agent.
--
-- The Agent's model is its own Engine profile's (ADR 0016): gtmworks remembers only which Agents chose a model of their
-- own, so the Company default can be written to every other Agent profile and to the shared space. Nothing existing is
-- rewritten: both columns are additive, and an Agent starts with no choice and sub-agents off (Omar, 2026-11-18).
--
-- Sub-agents need the Engine's `delegation` toolset, which ADR 0014 keeps off at every level. Policy 4 adds the variant
-- an Agent's profile takes only when its Owner turned sub-agents on: the level's toolsets and `delegation`, with
-- terminal, files and code execution still disabled. The previous app version never reads either column and never calls
-- the new functions; its worker records tools as before (`record_agent_profile`'s fifth argument is optional).

alter table public.agent_profiles add column model_choice text;
alter table public.agent_profiles add column subagents boolean not null default false;
-- A model travels as provider/model, as the Engine's profile route takes it (web_routers/profiles.py 1056-1068).
alter table public.agent_profiles add constraint agent_profiles_model_choice_shape
 check (model_choice is null or model_choice ~ '^[a-z0-9][a-z0-9._-]{0,63}/[^[:space:]/][^[:space:]]{0,199}$');

-- Policy 4: the sub-agent variant (lib/agent-levels.mjs).
create or replace function public.engine_tool_policy() returns integer language sql immutable set search_path='' as $$ select 4 $$;

-- The worker's list, now with the Agent's sub-agents choice: the same rows as before, and the worker writes that
-- profile's tools with the variant when it is on. The return type changed, so the function is made again.
drop function public.agent_profile_work();
create function public.agent_profile_work() returns table(agent_id uuid, profile text, agent_level smallint, tools_level smallint, tools_policy integer, tools_pending boolean, instructions text, subagents boolean)
language sql stable security definer set search_path='' as $$
 select p.agent_id,p.profile,co.agent_level,p.tools_level,p.tools_policy,p.tools_pending,a.instructions,p.subagents
 from public.agent_profiles p join public.hermes_agents a on a.id=p.agent_id and a.company_id=p.company_id
  join public.companies co on co.id=p.company_id
 where p.tools_level is null or p.tools_level<>co.agent_level or p.tools_policy is distinct from public.engine_tool_policy() or p.tools_pending
 order by p.tools_level is not null,md5(p.agent_id::text||date_trunc('minute',now())::text)
 limit 100;
$$;
revoke all on function public.agent_profile_work() from public,anon,authenticated;
grant execute on function public.agent_profile_work() to service_role;

-- The read-back of a profile whose tools were just written. The worker names the sub-agents choice it wrote, so a change
-- the Owner made while it wrote is never recorded as applied: the mismatch raises and the profile stays pending.
drop function public.record_agent_profile(uuid,text,integer,integer);
create function public.record_agent_profile(agent uuid, engine_profile text, level integer, policy integer, subagents_written boolean default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if engine_profile is distinct from public.agent_engine_profile(agent) or level is null or level not between 1 and 3 or policy is distinct from public.engine_tool_policy() then
  raise exception 'agentProfileInvalid' using errcode='22023'; end if;
 if subagents_written is not null and exists(select 1 from public.agent_profiles p where p.agent_id=record_agent_profile.agent and p.subagents is distinct from subagents_written) then
  raise exception 'agentProfileChanged' using errcode='40001'; end if;
 update public.agent_profiles set tools_level=level,tools_policy=policy,tools_pending=false where agent_id=agent;
end $$;
revoke all on function public.record_agent_profile(uuid,text,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.record_agent_profile(uuid,text,integer,integer,boolean) to service_role;

-- What a member reads for the "Each agent" rows (#29): each visible Agent's own profile, whether it is its own (an Agent
-- on the Company profile has no model of its own), whether it may hold a model choice, that choice and whether sub-agents
-- are on. A removed Agent can change nothing, so only the Agents the Company's own connections run are listed.
create function public.company_agent_models(c uuid)
returns table(agent uuid, name text, profile text, own boolean, choosable boolean, model_choice text, subagents boolean)
language sql stable security definer set search_path='' as $$
 select a.id,a.name,a.profile,
  (a.profile=p.profile and a.id=public.company_profile_keeper(c)) or exists(select 1 from public.agent_profiles ap where ap.agent_id=a.id and ap.company_id=c and ap.profile=a.profile),
  g.agent_id is not null,
  g.model_choice,coalesce(g.subagents,false)
 from public.hermes_agents a
  join public.company_profiles p on p.company_id=c
  left join public.agent_profiles g on g.agent_id=a.id and g.company_id=c
 where a.company_id=c and public.can_see_agent(c,a.id)
  and (a.profile=p.profile or a.profile=public.agent_engine_profile(a.id))
 order by a.is_default desc,a.name,a.id;
$$;
revoke all on function public.company_agent_models(uuid) from public,anon,service_role;
grant execute on function public.company_agent_models(uuid) to authenticated;

-- An Owner chooses an Agent's model, or null to follow the Company default again. Only an Agent whose own profile can
-- hold a choice is written; an Agent on the Company profile shares its model with the main Agent, so it is refused.
create function public.set_agent_model(agent uuid, model text) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 if model is not null and model !~ '^[a-z0-9][a-z0-9._-]{0,63}/[^[:space:]/][^[:space:]]{0,199}$' then
  raise exception 'settingInvalid' using errcode='22023'; end if;
 select a.company_id into c from public.hermes_agents a where a.id=set_agent_model.agent;
 if c is null then raise exception 'settingAgentUnknown' using errcode='P0002'; end if;
 if not public.is_company_owner(c) then raise exception 'settingNotAllowed' using errcode='42501'; end if;
 update public.agent_profiles p set model_choice=set_agent_model.model where p.agent_id=set_agent_model.agent and p.company_id=c;
 if not found then raise exception 'settingAgentShared' using errcode='42501'; end if;
end $$;
revoke all on function public.set_agent_model(uuid,text) from public,anon,service_role;
grant execute on function public.set_agent_model(uuid,text) to authenticated;

-- An Owner turns sub-agents on or off for one Agent. The profile is marked as changing before anything is written, so no
-- Run starts on it until the worker wrote the toolset and its read-back was recorded.
create function public.set_agent_subagents(agent uuid, enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 if enabled is null then raise exception 'settingInvalid' using errcode='22023'; end if;
 select a.company_id into c from public.hermes_agents a where a.id=set_agent_subagents.agent;
 if c is null then raise exception 'settingAgentUnknown' using errcode='P0002'; end if;
 if not public.is_company_owner(c) then raise exception 'settingNotAllowed' using errcode='42501'; end if;
 update public.agent_profiles p set subagents=set_agent_subagents.enabled,tools_pending=true where p.agent_id=set_agent_subagents.agent and p.company_id=c;
 if not found then raise exception 'settingAgentShared' using errcode='42501'; end if;
end $$;
revoke all on function public.set_agent_subagents(uuid,boolean) from public,anon,service_role;
grant execute on function public.set_agent_subagents(uuid,boolean) to authenticated;
