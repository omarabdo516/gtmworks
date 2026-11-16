-- #121, ADR 0016: on an install made before #120 every Agent of a Company runs on the Company's profile
-- `co-<company id>`. One Agent keeps that profile, untouched, so the Company's memory, Skills and sessions stay with it:
-- the keeper, which is the main Agent when the Company's first move starts and never changes after. Every other Agent
-- moves, one by one, to its own profile `ag-<agent id>` once the worker has made that profile with the Company level's
-- tools and it can answer (lib/company-profiles.mjs, moveAgentProfiles), and only while nothing of that Agent is in
-- flight. #120's owner record and guards then hold for it as for an Agent Lead made.
--
-- A Conversation's session stays in the profile it ran on: an imported session is never the one a Run with the
-- Conversation's session key loads (Engine v0.23.0 hermes_state_portability.py 789-803, gateway/platforms/api_server.py
-- 1603-1621). So the first Run of each Conversation after its Agent moved carries gtmworks's record of the Conversation as
-- the Run's history (pin_run_history; api_server_runs.py 488-525).
--
-- Nothing existing is rewritten: the new table and column start empty and every Agent stays where it is until the new
-- worker moves it. The previous app version runs against this: its reserve, record and close calls, lead_create_agent and
-- move_company_profile answer as before, and an Agent it makes on Lead's profile is moved by the new worker.

-- Which Agent keeps its Company's profile, recorded at the Company's first move. An Owner who later makes another Agent
-- the main one changes nothing here, so no profile changes hands; Lead's tools follow the main Agent (is_company_lead).
-- No foreign key to the Agent: a removed keeper's profile is handed to nobody.
create table public.company_profile_keepers (
 company_id uuid primary key references public.companies(id),
 agent_id uuid not null,
 recorded_at timestamptz not null default now()
);
alter table public.company_profile_keepers enable row level security;
revoke all on public.company_profile_keepers from anon,authenticated,service_role;

-- The recorded keeper; before the first move, the main Agent when it runs on the Company's bundled profile, else the
-- oldest Agent there (one made before Agents were dated counts as oldest).
create function public.company_profile_keeper(c uuid) returns uuid language sql stable security definer set search_path='' as $$
 select coalesce((select k.agent_id from public.company_profile_keepers k where k.company_id=c),
  (select a.id from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id
   where a.company_id=c and h.profile=public.company_engine_profile(c) and public.is_bundled_connection(h.id)
   order by a.is_default desc,a.created_at nulls first,a.id limit 1));
$$;
revoke all on function public.company_profile_keeper(uuid) from public,anon,authenticated,service_role;

-- Why an Agent cannot move now, as move_company_profile holds a Company: an open Run in one of its Conversations, a Run
-- reserved for it, an open channel or note Run of it, or a message in one of its Conversations in the last five minutes.
create function public.agent_move_blocked(agent uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   where cv.agent_id=agent and m.author='person'
    and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
    and not exists(select 1 from public.conversation_usage u where u.conversation_id=m.conversation_id and u.run_id=m.run_id))
  or exists(select 1 from public.conversation_run_reservations r where r.agent_id=agent and r.abandoned_at is null)
  or exists(select 1 from public.channel_runs r where r.agent_id=agent and r.outcome is null)
  or exists(select 1 from public.note_runs r where r.agent_id=agent and r.outcome is null)
  or exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   where cv.agent_id=agent and m.created_at>now()-interval '5 minutes');
$$;
revoke all on function public.agent_move_blocked(uuid) from public,anon,authenticated,service_role;

-- Whether this Agent sits on its Company's bundled profile and may leave it: it is not the keeper, and its Company has
-- an active Owner, in whose name the move is logged as the Company's move is.
create function public.agent_may_move(agent uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id
  where a.id=agent and h.profile=public.company_engine_profile(a.company_id) and public.is_bundled_connection(h.id)
   and a.id is distinct from public.company_profile_keeper(a.company_id)
   and exists(select 1 from public.members m where m.company_id=a.company_id and m.role='owner' and m.removed_at is null));
$$;
revoke all on function public.agent_may_move(uuid) from public,anon,authenticated,service_role;

-- The worker's list: each Agent that may move, of a Company whose own profile is ready, with nothing in flight, in an
-- order that turns every minute, so a hundred whose profiles cannot answer never hold back the others. `recorded`: its
-- owner record exists, so the worker skips begin_agent_profile_move.
create function public.agent_move_work() returns table(agent_id uuid, company_id uuid, profile text, agent_level smallint, instructions text, recorded boolean)
language sql stable security definer set search_path='' as $$
 select a.id,a.company_id,public.agent_engine_profile(a.id),co.agent_level,a.instructions,
  exists(select 1 from public.agent_profiles p where p.agent_id=a.id)
 from public.hermes_agents a join public.companies co on co.id=a.company_id
 where public.company_profile_ready(a.company_id) and public.agent_may_move(a.id) and not public.agent_move_blocked(a.id)
 order by md5(a.id::text||date_trunc('minute',now())::text)
 limit 100;
$$;
revoke all on function public.agent_move_work() from public,anon,authenticated;
grant execute on function public.agent_move_work() to service_role;

-- Before the worker asks the Engine for the Agent's profile: the Company's keeper is recorded if it is not yet, and the
-- Agent's owner record is written, which #120's guards need before a Connection may name the profile. False for the
-- keeper and for an Agent not on its Company's bundled profile. Running it again changes nothing.
create function public.begin_agent_profile_move(agent uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare moving public.hermes_agents;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into moving from public.hermes_agents where id=agent;
 if not found or not exists(select 1 from public.hermes_connections h where h.id=moving.connection_id
  and h.profile=public.company_engine_profile(moving.company_id) and public.is_bundled_connection(h.id)) then return false; end if;
 insert into public.company_profile_keepers(company_id,agent_id) values(moving.company_id,public.company_profile_keeper(moving.company_id))
  on conflict (company_id) do nothing;
 if not public.agent_may_move(agent) then return false; end if;
 insert into public.agent_profiles(agent_id,company_id) values(agent,moving.company_id) on conflict (agent_id) do nothing;
 return true;
end $$;
revoke all on function public.begin_agent_profile_move(uuid) from public,anon,authenticated;
grant execute on function public.begin_agent_profile_move(uuid) to service_role;

-- The move, checked again under the lock every Run entry takes: its profile's tools are those of the Company's level and
-- policy, read back and recorded, and nothing of it is in flight. A new Connection to its own profile, with the old one's
-- address, key, version, features and owner, the Agent on it, the old Connection removed once nothing holds it, and one
-- log row. True when it moved.
create function public.move_agent_profile(agent uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare moving public.hermes_agents; old public.hermes_connections; linked uuid; first_owner uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into moving from public.hermes_agents where id=agent;
 if not found or not public.company_profile_ready(moving.company_id) or not public.agent_may_move(agent) or public.agent_move_blocked(agent)
  or not exists(select 1 from public.agent_profiles p join public.companies co on co.id=p.company_id where p.agent_id=agent and p.company_id=moving.company_id
   and p.tools_level=co.agent_level and p.tools_policy=public.engine_tool_policy() and not p.tools_pending) then return false; end if;
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
revoke all on function public.move_agent_profile(uuid) from public,anon,authenticated;
grant execute on function public.move_agent_profile(uuid) to service_role;

-- The moved Agent's Connection is the worker's kind, as the others are: Lead's tools follow it when it is made the main
-- Agent (is_company_lead), and tool health forgets it when the Engine lost its profile. 20261214000000's, but for that.
create or replace function public.is_bundled_connection(connection uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hermes_agent_audit u where u.action in ('PROVIDE_BUNDLED_HERMES_AGENT','MOVE_COMPANY_PROFILE','REQUEST_HERMES_AGENT','MOVE_AGENT_PROFILE')
  and u.details->>'connection_id'=connection::text);
$$;

-- The log names the move.
create or replace function public.log_agent_action(action text) returns text language sql immutable set search_path='' as $$
 select case action when 'ATTACH_HERMES_AGENT' then 'agent_added' when 'DEFAULT_HERMES_AGENT' then 'agent_made_main'
  when 'REMOVE_HERMES_AGENT' then 'agent_removed' when 'PROVIDE_BUNDLED_HERMES_AGENT' then 'agent_provided'
  when 'MOVE_COMPANY_PROFILE' then 'agent_own_profile' when 'REQUEST_HERMES_AGENT' then 'agent_requested'
  when 'MOVE_AGENT_PROFILE' then 'agent_own_space' else lower(action) end;
$$;

-- The history a Run carries, pinned at its first start as its knowledge is (pin_run_knowledge): when the Run is reserved
-- on its Agent's own profile and no reply of the Agent was written in this Conversation since the Agent moved there, the
-- Conversation's messages in order as [{role,content}], the newest kept within 6,000,000 bytes (the Engine takes a body
-- of 10 MB, api_server.py 170). Every retry sends what was pinned; any other Run, and one the previous app version
-- already tried to start, carries none.
alter table public.conversation_run_notes add column history jsonb;
create function public.pin_run_history(conversation uuid, message_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare held public.conversation_run_reservations; kept public.conversation_run_notes; moved_at timestamptz; record jsonb;
begin
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key for update;
 select * into kept from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if kept.conversation_id is null then return null; end if;
 if kept.history is null and held.conversation_id is not null and held.start_attempts=0 and held.start_unknown_at is null
  and held.profile=public.agent_engine_profile(held.agent_id) then
  select max(u.created_at) into moved_at from public.hermes_agent_audit u where u.agent_id=held.agent_id and u.company_id=held.company_id and u.action='MOVE_AGENT_PROFILE';
  if moved_at is not null and not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='agent' and m.created_at>=moved_at) then
   select jsonb_agg(x.entry order by x.id) into record from (
    select m.id,e.entry,sum(octet_length(e.entry::text)) over (order by m.id desc) as total
    from public.conversation_messages m,
     lateral (select jsonb_build_object('role',case m.author when 'agent' then 'assistant' else 'user' end,'content',m.body) as entry) e
    where m.conversation_id=conversation and m.send_key is distinct from message_key) x
   where x.total<=6000000;
   if record is not null then
    update public.conversation_run_notes n set history=record where n.conversation_id=conversation and n.send_key=message_key returning * into kept;
   end if;
  end if;
 end if;
 return kept.history;
end $$;
revoke all on function public.pin_run_history(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pin_run_history(uuid,uuid) to service_role;
