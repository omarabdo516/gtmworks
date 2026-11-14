-- One Hermes profile per Company (#2, ADR 0014), the Company's Agent level (Omar, 2026-11-13, rule e) and the Owner's
-- warning about an Agent with terminal, code or file tools (rule f).
--
-- Profiles. The bundled Engine gave every Company the shared `default` profile (ADR 0010), so their memory was shared.
-- Now the worker makes each Company its own profile, `co-<company id without dashes>` (company_engine_profile), records
-- it here with the Agent level its tools were written for, and connects the Company to it:
--  - a Company with no Hermes at all is attached to its own profile at once (a Connection and the main Agent, Lead);
--  - a Company whose Agents run on a bundled Connection to another profile (the old shared `default`) keeps running
--    there and is moved to its own profile by the worker once that profile can answer (it holds a model sign-in) and
--    no Run of those Agents is open. Memory already written on `default` stays there and is not split.
-- A bundled Connection is one the worker made (its PROVIDE_BUNDLED_HERMES_AGENT or MOVE_COMPANY_PROFILE audit row). A
-- pasted Connection is never replaced or moved (ADR 0010). The previous app version's functions are left as they were:
-- its worker may still give a new Company the `default` profile while an update runs, and this worker then moves it.
--
-- Levels. companies.agent_level is 1 (read and draft), 2 (act on approval) or 3 (scheduled work), 1 for every Company
-- now and for each new one. Only an Owner changes it, through set_agent_level, and each change is in the Company's log.
-- The worker keeps the profile's tools in step with it (lib/agent-levels.mjs).
--
-- Health. The worker reads, for every connected Connection with an Agent, the toolsets Hermes enables for its Runs and
-- records which of terminal, code_execution and file are on. agent_tool_warning tells a Company's Owner which of its
-- Agents have one while the Company has more than one member.
--
-- Nothing existing is rewritten: the new columns have defaults and the new tables start empty.

alter table public.companies add column agent_level smallint not null default 1 check (agent_level between 1 and 3);

-- A level change is kept in company_audit beside renames and copied into the Company's log.
alter table public.company_audit drop constraint company_audit_action_check;
alter table public.company_audit add constraint company_audit_action_check check (action in ('company_renamed','agent_level_changed'));
alter table public.company_audit alter column old_name drop not null, alter column new_name drop not null,
 add column old_level smallint, add column new_level smallint;
alter table public.company_audit add constraint company_audit_values check (
 (action='company_renamed' and old_name is not null and new_name is not null)
 or (action='agent_level_changed' and old_level between 1 and 3 and new_level between 1 and 3));

create or replace function public.log_company_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),(select name from public.people where id=new.actor_id),
   'company',new.action,case when new.action='agent_level_changed' then jsonb_build_object('old_level',new.old_level,'new_level',new.new_level)
    else jsonb_build_object('old_name',new.old_name,'new_name',new.new_name) end,'company_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_company_change() from public,anon,authenticated,service_role;

create function public.set_agent_level(c uuid, level integer) returns integer
language plpgsql security definer set search_path='' as $$
declare previous smallint;
begin
 if not public.is_company_owner(c) then raise exception 'agentLevelNotAllowed' using errcode='42501'; end if;
 if level is null or level not between 1 and 3 then raise exception 'agentLevelInvalid' using errcode='22023'; end if;
 select agent_level into previous from public.companies where id=c for update;
 if previous is distinct from level then
  update public.companies set agent_level=level where id=c;
  insert into public.company_audit(company_id,actor_id,action,old_level,new_level) values (c,auth.uid(),'agent_level_changed',previous,level);
 end if;
 return level;
end $$;
revoke all on function public.set_agent_level(uuid,integer) from public,anon,service_role;
grant execute on function public.set_agent_level(uuid,integer) to authenticated;

-- The Company's own profile in the bundled Engine, written by the worker once Hermes made it, with the Agent level its
-- tool configuration was last written for.
create table public.company_profiles (
 company_id uuid primary key references public.companies(id),
 profile text not null unique check (profile ~ '^co-[0-9a-f]{32}$'),
 tools_level smallint not null check (tools_level between 1 and 3),
 created_at timestamptz not null default now()
);
alter table public.company_profiles enable row level security;
revoke all on public.company_profiles from anon,authenticated,service_role;

create function public.company_engine_profile(c uuid) returns text language sql immutable set search_path='' as $$
 select 'co-'||replace(c::text,'-','');
$$;
revoke all on function public.company_engine_profile(uuid) from public,anon,authenticated,service_role;

create function public.is_bundled_connection(connection uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hermes_agent_audit u where u.action in ('PROVIDE_BUNDLED_HERMES_AGENT','MOVE_COMPANY_PROFILE') and u.details->>'connection_id'=connection::text);
$$;
revoke all on function public.is_bundled_connection(uuid) from public,anon,authenticated,service_role;

-- What the worker has to do: each Company with an active Owner that has no Hermes at all (attach) or whose Agents run on
-- a bundled Connection to another profile (move), each Company whose profile's tools lag behind its level, and each
-- Company on its own profile that has no record of it (the Engine lost it, after a restore from a backup that does not
-- hold the Engine's data): the profile is made again.
create function public.company_profile_work() returns table(company_id uuid, profile text, agent_level smallint, tools_level smallint, attach boolean, move boolean)
language sql stable security definer set search_path='' as $$
 select w.id,public.company_engine_profile(w.id),w.agent_level,w.tools_level,w.attach,w.move from (
  select c.id,c.agent_level,p.tools_level,
   p.company_id is null and exists(select 1 from public.hermes_connections h where h.company_id=c.id and h.profile=public.company_engine_profile(c.id) and public.is_bundled_connection(h.id)) as lost,
   not exists(select 1 from public.hermes_connections h where h.company_id=c.id) and not exists(select 1 from public.hermes_agents a where a.company_id=c.id) as attach,
   exists(select 1 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id
    where a.company_id=c.id and h.profile<>public.company_engine_profile(c.id) and public.is_bundled_connection(h.id)) as move
  from public.companies c left join public.company_profiles p on p.company_id=c.id
  where exists(select 1 from public.members m where m.company_id=c.id and m.role='owner' and m.removed_at is null)) w
 where w.attach or w.move or w.lost or (w.tools_level is not null and w.tools_level<>w.agent_level)
 order by w.id limit 100;
$$;
revoke all on function public.company_profile_work() from public,anon,authenticated;
grant execute on function public.company_profile_work() to service_role;

create function public.record_company_profile(c uuid, engine_profile text, level integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if engine_profile is distinct from public.company_engine_profile(c) or level is null or level not between 1 and 3 then raise exception 'companyProfileInvalid' using errcode='22023'; end if;
 insert into public.company_profiles(company_id,profile,tools_level) values (c,engine_profile,level)
  on conflict (company_id) do update set tools_level=excluded.tools_level;
end $$;
revoke all on function public.record_company_profile(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.record_company_profile(uuid,text,integer) to service_role;

-- The Engine no longer knows a bundled Connection's company profile: its record goes, so the worker makes it again.
create function public.forget_company_profile(connection uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 delete from public.company_profiles p using public.hermes_connections h
  where h.id=connection and p.company_id=h.company_id and p.profile=h.profile and public.is_bundled_connection(h.id);
 return found;
end $$;
revoke all on function public.forget_company_profile(uuid) from public,anon,authenticated;
grant execute on function public.forget_company_profile(uuid) to service_role;

-- Whether a Company may run on its profile now: the profile is made and its tools are those of the Company's level.
create function public.company_profile_ready(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.company_profiles p join public.companies co on co.id=p.company_id where p.company_id=c and p.tools_level=co.agent_level);
$$;
revoke all on function public.company_profile_ready(uuid) from public,anon,authenticated,service_role;

-- A Company with no Hermes at all gets a Connection to its own profile and its main Agent, Lead, in the name of its
-- first Owner, like provide_bundled_hermes did for the shared profile. The key arrives already encrypted (ADR 0008).
create function public.attach_company_profile(c uuid, bundled_address text, bundled_key text, bundled_version text, bundled_features text[]) returns boolean
language plpgsql security definer set search_path='' as $$
declare first_owner uuid; linked uuid; agent uuid;
begin
 if public.hermes_profile_address(bundled_address) is null or coalesce(bundled_key,'')='' or not ('run_submission'=any(coalesce(bundled_features,'{}'))) then raise exception 'hermesAgentFailed' using errcode='22023'; end if;
 -- The same lock as agent assignments: a company is provided once, even with a second worker.
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if not public.company_profile_ready(c) or exists(select 1 from public.hermes_connections h where h.company_id=c) or exists(select 1 from public.hermes_agents a where a.company_id=c) then return false; end if;
 select m.person_id into first_owner from public.members m where m.company_id=c and m.role='owner' and m.removed_at is null order by m.person_id limit 1;
 if first_owner is null then return false; end if;
 insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state,version,features)
  values(c,first_owner,bundled_address,public.company_engine_profile(c),bundled_key,'connected',bundled_version,bundled_features) returning id into linked;
 insert into public.hermes_agents(company_id,connection_id,name,speciality,is_default) values(c,linked,'Lead','General',true) returning id into agent;
 insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
  values(c,first_owner,(select name from public.people where id=first_owner),agent,'PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id',linked));
 return true;
end $$;
revoke all on function public.attach_company_profile(uuid,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.attach_company_profile(uuid,text,text,text,text[]) to service_role;

-- Tool health (rule f): the last reading of each connected Connection's enabled toolsets that must not be on in a
-- shared Company. Written by the worker only.
create table public.engine_tool_checks (
 connection_id uuid primary key references public.hermes_connections(id) on delete cascade,
 company_id uuid not null references public.companies(id),
 risky text[] not null check (risky <@ array['terminal','code_execution','file']::text[]),
 checked_at timestamptz not null default now()
);
alter table public.engine_tool_checks enable row level security;
revoke all on public.engine_tool_checks from anon,authenticated,service_role;

-- A Company's Agents on a bundled Connection to another profile move to their Company's own profile: each such
-- Connection gets a new one, made in the name of the Company's first Owner, that names the Company's profile, and the
-- Company's Agents on it are attached to the new one (a Connection keeps its destination, so it is never retargeted).
-- An old Connection no Agent uses any more is removed; one an Agent of another Company still uses stays. Nothing moves
-- while a Run of one of those Agents is open: the Run is read on the profile it started on. Returns the Agents moved.
create function public.move_company_profile(c uuid, bundled_address text, bundled_key text, bundled_version text, bundled_features text[]) returns integer
language plpgsql security definer set search_path='' as $$
declare first_owner uuid; olds uuid[]; old uuid; linked uuid; agent uuid; moved integer:=0;
begin
 if public.hermes_profile_address(bundled_address) is null or coalesce(bundled_key,'')='' or not ('run_submission'=any(coalesce(bundled_features,'{}'))) then raise exception 'hermesAgentFailed' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if not public.company_profile_ready(c) then return 0; end if;
 select m.person_id into first_owner from public.members m where m.company_id=c and m.role='owner' and m.removed_at is null order by m.person_id limit 1;
 if first_owner is null then return 0; end if;
 olds:=array(select distinct a.connection_id from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id
  where a.company_id=c and h.profile<>public.company_engine_profile(c) and public.is_bundled_connection(h.id));
 if exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   join public.hermes_agents a on a.id=cv.agent_id and a.company_id=cv.company_id
   where a.company_id=c and a.connection_id=any(olds) and m.author='person'
    and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
    and not exists(select 1 from public.conversation_usage u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)) then
  return 0;
 end if;
 foreach old in array olds loop
  insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state,version,features)
   values(c,first_owner,bundled_address,public.company_engine_profile(c),bundled_key,'connected',bundled_version,bundled_features) returning id into linked;
  for agent in update public.hermes_agents set connection_id=linked where company_id=c and connection_id=old returning id loop
   insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
    values(c,first_owner,(select name from public.people where id=first_owner),agent,'MOVE_COMPANY_PROFILE',jsonb_build_object('connection_id',linked,'from_connection_id',old));
   moved:=moved+1;
  end loop;
  delete from public.hermes_connections h where h.id=old and not exists(select 1 from public.hermes_agents a where a.connection_id=old);
 end loop;
 return moved;
end $$;
revoke all on function public.move_company_profile(uuid,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.move_company_profile(uuid,text,text,text,text[]) to service_role;

-- The log names the move.
create or replace function public.log_agent_action(action text) returns text language sql immutable set search_path='' as $$
 select case action when 'ATTACH_HERMES_AGENT' then 'agent_added' when 'DEFAULT_HERMES_AGENT' then 'agent_made_main'
  when 'REMOVE_HERMES_AGENT' then 'agent_removed' when 'PROVIDE_BUNDLED_HERMES_AGENT' then 'agent_provided'
  when 'MOVE_COMPANY_PROFILE' then 'agent_own_profile' else lower(action) end;
$$;
revoke all on function public.log_agent_action(text) from public,anon,authenticated,service_role;

-- The Connections to read: connected ones that an Agent uses, with the key the worker decrypts only to ask Hermes.
create function public.engine_tools_due() returns table(connection uuid, address text, profile text, key_encrypted text)
language sql stable security definer set search_path='' as $$
 select h.id,h.address,h.profile,h.key_encrypted from public.hermes_connections h
 where h.state='connected' and exists(select 1 from public.hermes_agents a where a.connection_id=h.id)
 order by h.id limit 500;
$$;
revoke all on function public.engine_tools_due() from public,anon,authenticated;
grant execute on function public.engine_tools_due() to service_role;

create function public.record_engine_tools(connection uuid, risky text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if risky is null or not (risky <@ array['terminal','code_execution','file']::text[]) then raise exception 'engineToolsInvalid' using errcode='22023'; end if;
 insert into public.engine_tool_checks(connection_id,company_id,risky)
  select h.id,h.company_id,risky from public.hermes_connections h where h.id=connection
  on conflict (connection_id) do update set risky=excluded.risky,checked_at=now();
end $$;
revoke all on function public.record_engine_tools(uuid,text[]) from public,anon,authenticated;
grant execute on function public.record_engine_tools(uuid,text[]) to service_role;

-- The Owner's warning: the Company's Agents whose Engine offers terminal, code or file tools, while more than one
-- person is a member. A non-Owner, or a Company of one, gets no rows. Legacy agent identities are not people.
create function public.agent_tool_warning(c uuid) returns table(agent uuid, agent_name text, toolsets text[])
language sql stable security definer set search_path='' as $$
 select a.id,a.name,k.risky from public.hermes_agents a join public.engine_tool_checks k on k.connection_id=a.connection_id
 where a.company_id=c and cardinality(k.risky)>0 and public.is_company_owner(c)
  and (select count(*) from public.members m where m.company_id=c and m.removed_at is null and m.agent_role is null
   and not exists(select 1 from public.agents g where g.id=m.person_id))>1
 order by a.is_default desc,a.name;
$$;
revoke all on function public.agent_tool_warning(uuid) from public,anon,service_role;
grant execute on function public.agent_tool_warning(uuid) to authenticated;

-- Where a Company's model sign-in lives (#3): its own profile, reached with the key of one of its bundled
-- Connections (the install key). Members may read the sign-in state; the route lets only an Owner change it.
create function public.company_engine_target(c uuid) returns table(connection uuid, address text, profile text)
language sql stable security definer set search_path='' as $$
 select h.id,h.address,p.profile from public.company_profiles p join public.hermes_connections h on h.company_id=p.company_id
 where p.company_id=c and public.is_member(c) and public.is_bundled_connection(h.id)
 order by h.profile=p.profile desc,h.id limit 1;
$$;
revoke all on function public.company_engine_target(uuid) from public,anon,service_role;
grant execute on function public.company_engine_target(uuid) to authenticated;
