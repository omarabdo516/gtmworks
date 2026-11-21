-- #391, ADR 0018, ADR 0023: Agent levels are removed whole, in two steps, so an update never leaves the release it
-- replaces running on a database it cannot use. This file is the first step: it only adds. The confirmation that replaces
-- the level (a profile records whether the worker read back exactly the one fixed set every Agent gets,
-- lib/agent-toolsets.mjs), the functions that write it, and the worker's health list with the sub-agents switch are added
-- beside everything the previous release calls, which keeps its columns, signatures and meaning: its level route, its
-- profile records with a level and a policy, and its eight-argument call that makes an Agent for Lead.
--
-- The removal itself is 20270416000000_one_set_of_tools_cutover.sql, which scripts/install.sh applies only once this
-- release's app and worker answer: until then a failed update leaves the previous release serving on a schema it was
-- built for (ADR 0023).

-- 1. The confirmation, beside the level the previous release still reads and writes.
alter table public.company_profiles add column tools_confirmed boolean not null default false;
alter table public.agent_profiles add column tools_confirmed boolean not null default false;
-- A Company profile this release's worker records has no level: the previous release reads a null level as a profile
-- that is not set up yet, as it reads one it has not written.
alter table public.company_profiles alter column tools_level drop not null;

-- 2. The writers of the confirmation. The two record functions are this release's overloads, named by their own
-- arguments: the previous release's calls name a level and a policy and reach its own, which stay until the cutover.
-- The worker records the read-back of the fixed set; no level and no policy is named anywhere. The read-back names the
-- sub-agents switch the worker wrote (20270407042500, #425): a change the Owner made while it wrote is never recorded as
-- applied, and the profile stays pending.
create function public.record_company_profile(c uuid, engine_profile text, subagents_written boolean default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if engine_profile is distinct from public.company_engine_profile(c) then raise exception 'companyProfileInvalid' using errcode='22023'; end if;
 -- The row is locked first, so an Owner's switch cannot land between this check and the record below.
 perform 1 from public.company_profiles p where p.company_id=c for update;
 if subagents_written is not null and exists(select 1 from public.company_profiles p where p.company_id=c and p.subagents is distinct from subagents_written) then
  raise exception 'companyProfileChanged' using errcode='40001'; end if;
 insert into public.company_profiles(company_id,profile,tools_confirmed) values (c,engine_profile,true)
  -- A worker that names no switch writes no delegation: its read-back never clears a switch that is on.
  on conflict (company_id) do update set tools_confirmed=true,
   tools_pending=record_company_profile.subagents_written is null and public.company_profiles.subagents;
end $$;
revoke all on function public.record_company_profile(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.record_company_profile(uuid,text,boolean) to service_role;

-- Only lead_create_agent writes an owner record; the worker records the read-back of the fixed set on one that exists,
-- refusing a sub-agents choice the Owner changed while it wrote.
create function public.record_agent_profile(agent uuid, engine_profile text, subagents_written boolean default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if engine_profile is distinct from public.agent_engine_profile(agent) then raise exception 'agentProfileInvalid' using errcode='22023'; end if;
 perform 1 from public.agent_profiles p where p.agent_id=record_agent_profile.agent for update;
 if subagents_written is not null and exists(select 1 from public.agent_profiles p where p.agent_id=record_agent_profile.agent and p.subagents is distinct from subagents_written) then
  raise exception 'agentProfileChanged' using errcode='40001'; end if;
 update public.agent_profiles set tools_confirmed=true,tools_pending=false where agent_id=agent;
end $$;
revoke all on function public.record_agent_profile(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.record_agent_profile(uuid,text,boolean) to service_role;

-- The worker marks a profile as changing before it writes the tools, so no Run starts on it until its read-back is
-- recorded. Both a Company's profile and an Agent's own are named by their Engine profile.
create function public.begin_profile_tools(profile text) returns void language sql security definer set search_path='' as $$
 update public.company_profiles set tools_pending=true where profile=begin_profile_tools.profile;
 update public.agent_profiles set tools_pending=true where profile=begin_profile_tools.profile;
$$;
revoke all on function public.begin_profile_tools(text) from public,anon,authenticated;
grant execute on function public.begin_profile_tools(text) to service_role;

-- The read-back of a profile the tool check corrected, by the Engine's profile name.
create function public.record_profile_tools(profile text, subagents_written boolean default null) returns void
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
begin
 -- Both profiles' rows are locked first, so an Owner's switch cannot land between the checks and the record below.
 perform 1 from public.company_profiles p where p.profile=record_profile_tools.profile for update;
 perform 1 from public.agent_profiles p where p.profile=record_profile_tools.profile for update;
 if subagents_written is not null and exists(select 1 from public.agent_profiles p where p.profile=record_profile_tools.profile and p.subagents is distinct from subagents_written) then
  raise exception 'agentProfileChanged' using errcode='40001'; end if;
 -- The main Agent's switch, on its Company profile (#425), is checked the same way.
 if subagents_written is not null and exists(select 1 from public.company_profiles p where p.profile=record_profile_tools.profile and p.subagents is distinct from subagents_written) then
  raise exception 'agentProfileChanged' using errcode='40001'; end if;
 update public.company_profiles set tools_confirmed=true,tools_pending=false where profile=record_profile_tools.profile;
 update public.agent_profiles set tools_confirmed=true,tools_pending=false where profile=record_profile_tools.profile;
end $$;
revoke all on function public.record_profile_tools(text,boolean) from public,anon,authenticated;
grant execute on function public.record_profile_tools(text,boolean) to service_role;

-- 20270402's health list, now with the Agent's sub-agents choice, so a profile the Engine reports differently is
-- corrected with the variant its Owner set. The list is read a page at a time, so its order turns with the minute (as the
-- other work lists do): a profile past the page is in the next minute's, and every profile is checked.
drop function public.engine_tools_due();
create function public.engine_tools_due() returns table(company_id uuid, profile text, subagents boolean)
language sql stable security definer set search_path='' as $$
 select due.company_id,due.profile,due.subagents from (
  select distinct a.company_id,a.profile,
   -- The main Agent's switch is kept on its Company profile (#425), so a co- profile reads it there, the same for every
   -- Agent that still names that profile; an Agent's own profile reads its own.
   case when a.profile like 'co-%' then coalesce((select c.subagents from public.company_profiles c where c.profile=a.profile),false)
    else coalesce((select p.subagents from public.agent_profiles p where p.profile=a.profile and p.agent_id=a.id),false) end as subagents,
   md5(a.profile||date_trunc('minute',now())::text) as turn
  from public.hermes_agents a where a.profile ~ '^(co|ag)-[0-9a-f]{32}$') due
 order by due.turn limit 500;
$$;
revoke all on function public.engine_tools_due() from public,anon,authenticated;
grant execute on function public.engine_tools_due() to service_role;

-- 3. The one function that makes an Agent for Lead's call, for both releases while an update runs: a call that names
-- own_profile is this release's (the Engine provided the profile with the fixed set and read it back); any other is the
-- previous release's, with its level and policy, as 20270213 made it. The cutover replaces it with this release's alone.
drop function public.lead_create_agent(uuid,text,text,text,text,text[],text,text,integer,integer,boolean);
create function public.lead_create_agent(conversation uuid, run text, call text, agent_name text, job text, apps text[], template text default null, instructions text default null,
 own_level integer default null, own_policy integer default null, own_answers boolean default true, own_profile boolean default null) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare talk public.conversations; source text; made uuid; held boolean; own boolean;
 agent uuid:=public.lead_agent_id(conversation,run,call);
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select l.agent_id into made from public.lead_made_agents l where l.conversation_id=conversation and l.run_id=run and l.call_id=call;
 if own_profile is null then
  if found then
   -- A closer that raced the one that made the Agent wrote its tools to the same profile, perhaps after the worker had
   -- recorded a later level: unless they are the recorded ones, the worker writes and reads them back again first.
   if own_level is not null then
    update public.agent_profiles p set tools_pending=true where p.agent_id=made and (p.tools_level is distinct from own_level or p.tools_policy is distinct from own_policy);
   end if;
   return jsonb_build_object('state','created','agent',made);
  end if;
 else
  if found then
   if own_profile then update public.agent_profiles p set tools_confirmed=true,tools_pending=false where p.agent_id=made; end if;
   return jsonb_build_object('state','created','agent',made);
  end if;
 end if;
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not (public.may_use_lead_tools(talk.company_id,talk.agent_id,talk.person_id)
   or exists(select 1 from public.lead_agent_requests r where r.conversation_id=conversation and r.run_id=run and r.call_id=call and r.state='made'
    and public.may_use_lead_tools(talk.company_id,talk.agent_id,r.answered_by))) then return jsonb_build_object('state','refused'); end if;
 if own_profile is null then
  if not public.agent_fields_valid(agent_name,job,apps,template,instructions) or (own_level is null)<>(own_policy is null) or own_level not between 1 and 3
   or own_answers is null then
   return jsonb_build_object('state','invalid'); end if;
 elsif not public.agent_fields_valid(agent_name,job,apps,template,instructions) or own_level is not null or own_policy is not null or own_answers is null then
  return jsonb_build_object('state','invalid');
 end if;
 held:=public.company_holds_provider_key(talk.company_id);
 if not held and not own_answers then
  own_level:=null; own_policy:=null;
  if own_profile is not null then own_profile:=false; end if;
 end if;
 own:=coalesce(own_profile,own_level is not null) or held;
 select a.profile into source from public.hermes_agents a where a.id=talk.agent_id;
 if own then
  if own_profile is null then
   insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) values(agent,talk.company_id,own_level,own_policy);
  else
   insert into public.agent_profiles(agent_id,company_id,tools_confirmed,tools_pending) values(agent,talk.company_id,own_profile,not own_profile);
  end if;
 end if;
 insert into public.hermes_agents(id,company_id,profile,name,speciality,requested_by,apps,template,instructions)
  values(agent,talk.company_id,
   case when own then public.agent_engine_profile(agent) when source ~ '^ag-[0-9a-f]{32}$' then public.company_engine_profile(talk.company_id) else source end,
   trim(agent_name),trim(job),talk.person_id,array(select trim(app) from unnest(apps) app),template,
   replace(instructions,'{company}',(select c.name from public.companies c where c.id=talk.company_id))) returning id into made;
 insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id) values(conversation,run,call,talk.company_id,made);
 if held and (not coalesce(own_profile,own_level is not null) or not own_answers) then insert into public.agent_key_waits(agent_id,company_id) values(made,talk.company_id); end if;
 perform public.log_agent_event(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),made,'REQUEST_HERMES_AGENT',
  jsonb_strip_nulls(jsonb_build_object('agent_name',trim(agent_name),'job',trim(job),'conversation_id',conversation,'template',template)));
 return jsonb_build_object('state','created','agent',made);
end $function$;
revoke all on function public.lead_create_agent(uuid,text,text,text,text,text[],text,text,integer,integer,boolean,boolean) from public,anon,authenticated;
grant execute on function public.lead_create_agent(uuid,text,text,text,text,text[],text,text,integer,integer,boolean,boolean) to service_role;
