-- #122, ADR 0016: each Company has one shared Skills folder in the bundled Engine, the Skills of its shared space, the
-- profile `cs-<company id>`. The worker makes the space once (with no Run API key, so the Engine refuses every Run on it)
-- and writes the lessons the Company's Owners and Managers approved (#25) as its Skill "team-lessons"
-- (lib/shared-skills.mjs). Every Agent profile of the Company, its own `co-` one and each `ag-` one, reads that folder
-- and only that one, auto-loads the Skill and holds it locked against the Agent's own edits; the worker writes and
-- reads that back and records it here (skills_shared). No Run starts on a profile it has not recorded, and an Agent
-- moves to its own profile only once that profile is recorded. No Connection names a shared space.
--
-- Nothing existing is rewritten: the new tables start empty and every profile starts unconfirmed. The wait for a
-- confirmed folder holds only while a worker that confirms folders has listed its work within ten minutes
-- (shared_skills_active), so the previous app version runs against this as before: while it serves, during an update's
-- build or after a rollback, no worker of this version lists the work and its Runs and moves go on. Without that worker
-- a Run only misses the team's lessons; the lock that keeps them from an Agent's edits is the Engine's.

create table public.company_shared_spaces (
 company_id uuid primary key references public.companies(id) on delete cascade,
 profile text generated always as ('cs-'||replace(company_id::text,'-','')) stored unique,
 folder text not null,
 made_at timestamptz not null default now()
);
alter table public.company_shared_spaces enable row level security;
revoke all on public.company_shared_spaces from anon,authenticated,service_role;

-- When a worker that confirms shared folders last listed its work: one row.
create table public.shared_skills_worker (
 id boolean primary key default true check (id),
 seen_at timestamptz not null
);
alter table public.shared_skills_worker enable row level security;
revoke all on public.shared_skills_worker from anon,authenticated,service_role;
create function public.shared_skills_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.shared_skills_worker w where w.seen_at>now()-interval '10 minutes');
$$;
revoke all on function public.shared_skills_active() from public,anon,authenticated,service_role;

alter table public.company_profiles add column skills_shared boolean not null default false;
alter table public.agent_profiles add column skills_shared boolean not null default false;

create function public.shared_space_profile(c uuid) returns text language sql immutable set search_path='' as $$
 select 'cs-'||replace(c::text,'-','');
$$;
revoke all on function public.shared_space_profile(uuid) from public,anon,authenticated,service_role;

-- A shared space serves no Run, so no Connection names one, whoever writes it, and no Agent sits on one.
create function public.guard_shared_space_connection() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.profile ~ '^cs-[0-9a-f]{32}$' then raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_shared_space_connection() from public,anon,authenticated,service_role;
create trigger shared_space_connection before insert or update of profile on public.hermes_connections
 for each row execute function public.guard_shared_space_connection();

create function public.guard_shared_space_agent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.hermes_connections h where h.id=new.connection_id and h.profile ~ '^cs-[0-9a-f]{32}$') then
  raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_shared_space_agent() from public,anon,authenticated,service_role;
create trigger shared_space_agent before insert or update of connection_id on public.hermes_agents
 for each row execute function public.guard_shared_space_agent();

-- A Company runs on its own profile only once that profile also reads the Company's shared folder, confirmed.
-- 20261210000002's, unchanged but for that.
create or replace function public.company_profile_ready(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.company_profiles p join public.companies co on co.id=p.company_id
  where p.company_id=c and p.tools_level=co.agent_level and p.tools_policy=public.engine_tool_policy() and not p.tools_pending and (p.skills_shared or not public.shared_skills_active()));
$$;

-- Every Run entry asks this (20261226000000): a shared space never runs, and an Agent's own profile runs only once it
-- also reads the Company's shared folder, confirmed. 20261226000000's, unchanged but for those lines.
create or replace function public.agent_profile_refusal(engine_profile text, c uuid, agent uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
  when coalesce(engine_profile,'') ~ '^cs-[0-9a-f]{32}$' then 'hermesProfileNotShared'
  when coalesce(engine_profile,'') !~ '^ag-[0-9a-f]{32}$' then null
  when not exists(select 1 from public.agent_profiles p where p.profile=engine_profile and p.agent_id=agent and p.company_id=c) then 'hermesProfileNotShared'
  when not exists(select 1 from public.agent_profiles p join public.companies co on co.id=p.company_id
   where p.agent_id=agent and p.tools_level=co.agent_level and p.tools_policy=public.engine_tool_policy() and not p.tools_pending and (p.skills_shared or not public.shared_skills_active())) then 'agentLevelPending'
 end;
$$;

-- An Agent moves only to a profile whose shared folder is confirmed, so it never lands where its Runs would wait.
-- 20261228000000's, unchanged but for that.
create or replace function public.move_agent_profile(agent uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare moving public.hermes_agents; old public.hermes_connections; linked uuid; first_owner uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into moving from public.hermes_agents where id=agent;
 if not found or not public.company_profile_ready(moving.company_id) or not public.agent_may_move(agent) or public.agent_move_blocked(agent)
  or not exists(select 1 from public.agent_profiles p join public.companies co on co.id=p.company_id where p.agent_id=agent and p.company_id=moving.company_id
   and p.tools_level=co.agent_level and p.tools_policy=public.engine_tool_policy() and not p.tools_pending and (p.skills_shared or not public.shared_skills_active())) then return false; end if;
 select * into old from public.hermes_connections where id=moving.connection_id;
 select m.person_id into first_owner from public.members m where m.company_id=moving.company_id and m.role='owner' and m.removed_at is null order by m.person_id limit 1;
 insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state,version,features)
  values(moving.company_id,old.owner_id,old.address,public.agent_engine_profile(agent),old.key_encrypted,old.state,old.version,old.features) returning id into linked;
 update public.hermes_agents set connection_id=linked where id=agent;
 delete from public.hermes_connections h where h.id=old.id and not exists(select 1 from public.hermes_agents a where a.connection_id=old.id)
  and not exists(select 1 from public.conversation_run_reservations r where r.connection_id=old.id and r.abandoned_at is null);
 insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
  values(moving.company_id,first_owner,(select name from public.people where id=first_owner),agent,'MOVE_AGENT_PROFILE',jsonb_build_object('connection_id',linked,'from_connection_id',old.id));
 return true;
end $$;

-- A profile the Engine lost is made again with no shared folder, so its sharing is confirmed again too. A Company's
-- own profile loses its whole record here. 20261226000000's, unchanged but for that.
create or replace function public.forget_company_profile(connection uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare forgot boolean;
begin
 delete from public.company_profiles p using public.hermes_connections h
  where h.id=connection and p.company_id=h.company_id and p.profile=h.profile and public.is_bundled_connection(h.id);
 forgot:=found;
 update public.agent_profiles p set tools_level=null,tools_policy=null,tools_pending=false,skills_shared=false from public.hermes_connections h
  where h.id=connection and p.profile=h.profile and p.company_id=h.company_id and p.tools_level is not null and public.is_bundled_connection(h.id);
 return forgot or found;
end $$;

-- The worker's list: each Company with a recorded profile, with its shared space (its folder once made), the lessons
-- its Owners and Managers approved and nobody removed, oldest first, and each of its recorded profiles whose shared
-- folder is not confirmed. A rule told directly is not a lesson: only decide_agent_rule approves. Every Company is
-- listed on each pass, so a Skill changed or lost in the Engine is written again; a hundred at most, in an order that
-- turns every minute. Listing it marks the worker seen, which turns the wait for a confirmed folder on.
create function public.shared_skills_work() returns table(company_id uuid, profile text, folder text, lessons jsonb, profiles jsonb)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
begin
 insert into public.shared_skills_worker(id,seen_at) values(true,now()) on conflict (id) do update set seen_at=excluded.seen_at;
 return query select c.id,public.shared_space_profile(c.id),s.folder,
  coalesce((select jsonb_agg(r.body order by r.said_at,r.id) from public.agent_rules r where r.company_id=c.id and r.suggestion='approved' and r.removed_at is null),'[]'),
  coalesce((select jsonb_agg(jsonb_build_object('profile',x.profile) order by x.profile) from (
   select p.profile from public.company_profiles p where p.company_id=c.id and not p.skills_shared
   union all
   select p.profile from public.agent_profiles p where p.company_id=c.id and p.tools_level is not null and not p.skills_shared) x),'[]')
 from public.companies c left join public.company_shared_spaces s on s.company_id=c.id
 where exists(select 1 from public.company_profiles p where p.company_id=c.id)
  or exists(select 1 from public.agent_profiles p where p.company_id=c.id and p.tools_level is not null)
 order by md5(c.id::text||date_trunc('minute',now())::text)
 limit 100;
end $$;
revoke all on function public.shared_skills_work() from public,anon,authenticated;
grant execute on function public.shared_skills_work() to service_role;

-- The space the Engine made, recorded once: a second worker's record changes nothing. The folder must be the space's
-- own Skills folder. Answers the folder recorded.
create function public.record_shared_space(c uuid, folder text) returns text
language plpgsql security definer set search_path='' as $$
declare kept text;
begin
 if folder is null or length(folder)>4096 or folder ~ '[[:cntrl:]]' or folder not like '/%/'||public.shared_space_profile(c)||'/skills' then
  raise exception 'sharedSpaceInvalid' using errcode='22023'; end if;
 insert into public.company_shared_spaces(company_id,folder) values(c,folder) on conflict (company_id) do nothing;
 select s.folder into kept from public.company_shared_spaces s where s.company_id=c;
 return kept;
end $$;
revoke all on function public.record_shared_space(uuid,text) from public,anon,authenticated;
grant execute on function public.record_shared_space(uuid,text) to service_role;

-- A profile read back with its Company's folder alone and the shared Skill auto-loaded and locked. Only the Company's
-- own profile or one of its Agents', and only while its space is recorded: the space's row is held, so a forget
-- that meets this record waits and then clears it. True when it was recorded.
create function public.record_shared_skills(c uuid, engine_profile text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.company_shared_spaces s where s.company_id=c for share;
 if not found then return false; end if;
 update public.company_profiles p set skills_shared=true where p.company_id=c and p.profile=engine_profile;
 if found then return true; end if;
 update public.agent_profiles p set skills_shared=true where p.company_id=c and p.profile=engine_profile and p.tools_level is not null;
 return found;
end $$;
revoke all on function public.record_shared_skills(uuid,text) from public,anon,authenticated;
grant execute on function public.record_shared_skills(uuid,text) to service_role;

-- The Engine lost the space or its Skill: it is made again, and every profile of the Company waits until its shared
-- folder is confirmed again.
create function public.forget_shared_space(c uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 delete from public.company_shared_spaces s where s.company_id=c;
 update public.company_profiles p set skills_shared=false where p.company_id=c and p.skills_shared;
 update public.agent_profiles p set skills_shared=false where p.company_id=c and p.skills_shared;
end $$;
revoke all on function public.forget_shared_space(uuid) from public,anon,authenticated;
grant execute on function public.forget_shared_space(uuid) to service_role;
