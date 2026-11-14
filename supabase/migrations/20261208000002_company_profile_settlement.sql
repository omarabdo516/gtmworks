-- Second review of the Company profiles (ADR 0014).
--
-- Tool policy. What each Agent level may use is versioned (engine_tool_policy, equal to toolPolicy in
-- lib/agent-levels.mjs; a change of the level table bumps both). A profile records the policy its tools were applied
-- under; one applied under another policy is work for the worker again, even at the same level, and runs on it wait.
--
-- Pending tools. The worker marks a profile's tools as changing (begin_company_tools) before it writes them, and only
-- the recorded read-back (record_company_profile, current policy only) clears the mark. A change Hermes applied but the
-- worker could not record therefore never looks applied: no run starts until the read-back matches again.
--
-- Reservations. A run is reserved before Hermes is called and recording its message ends the reservation. A retry
-- that finds its reservation passes the same checks as a new one (the profile is the company's, its tools are applied
-- and not pending) before it may start. gtmworks never calls Hermes to finish a reservation: one whose message was not
-- recorded within ten minutes, or whose Agent or sender's place in the company is gone, is marked abandoned by the
-- worker in one update (abandon_conversation_reservations). The person already saw an error and can send again. An
-- abandoned reservation is kept with its pinned Connection and profile for the record, and holds nothing: only an
-- active one holds the move, and the Connection's removal (a trigger, since a kept row must not keep a Connection).

-- Quiet window. The previous app version starts a run before it records it and never reserves. A move therefore also
-- waits until no message of the company's conversations on those Connections was written in the last five minutes.
-- What remains: a message the previous version sends after five quiet minutes, in the instant between its Hermes call
-- and its record, while the worker moves that company; that run would be read on the new profile and end as lost.
--
-- No existing gtmworks data is rewritten. Existing company profiles have no recorded policy, so the worker applies the
-- current tools to each once more.

create function public.engine_tool_policy() returns integer language sql immutable set search_path='' as $$ select 2 $$;
revoke all on function public.engine_tool_policy() from public,anon,authenticated;
grant execute on function public.engine_tool_policy() to service_role;

alter table public.company_profiles add column tools_policy integer, add column tools_pending boolean not null default false;

create or replace function public.company_profile_ready(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.company_profiles p join public.companies co on co.id=p.company_id
  where p.company_id=c and p.tools_level=co.agent_level and p.tools_policy=public.engine_tool_policy() and not p.tools_pending);
$$;

drop function public.company_profile_work();
create function public.company_profile_work() returns table(company_id uuid, profile text, agent_level smallint, tools_level smallint, tools_policy integer, tools_pending boolean, attach boolean, move boolean)
language sql stable security definer set search_path='' as $$
 select w.id,public.company_engine_profile(w.id),w.agent_level,w.tools_level,w.tools_policy,coalesce(w.tools_pending,false),w.attach,w.move from (
  select c.id,c.agent_level,p.tools_level,p.tools_policy,p.tools_pending,p.company_id is not null as recorded,
   p.company_id is null and exists(select 1 from public.hermes_connections h where h.company_id=c.id and h.profile=public.company_engine_profile(c.id) and public.is_bundled_connection(h.id)) as lost,
   not exists(select 1 from public.hermes_connections h where h.company_id=c.id) and not exists(select 1 from public.hermes_agents a where a.company_id=c.id) as attach,
   exists(select 1 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id
    where a.company_id=c.id and h.profile<>public.company_engine_profile(c.id) and public.is_bundled_connection(h.id)) as move
  from public.companies c left join public.company_profiles p on p.company_id=c.id
  where exists(select 1 from public.members m where m.company_id=c.id and m.role='owner' and m.removed_at is null)) w
 where w.attach or w.move or w.lost
  or (w.recorded and (w.tools_level<>w.agent_level or w.tools_policy is distinct from public.engine_tool_policy() or w.tools_pending))
 order by w.id limit 100;
$$;
revoke all on function public.company_profile_work() from public,anon,authenticated;
grant execute on function public.company_profile_work() to service_role;

drop function public.record_company_profile(uuid,text,integer);
create function public.record_company_profile(c uuid, engine_profile text, level integer, policy integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if engine_profile is distinct from public.company_engine_profile(c) or level is null or level not between 1 and 3 or policy is distinct from public.engine_tool_policy() then
  raise exception 'companyProfileInvalid' using errcode='22023'; end if;
 insert into public.company_profiles(company_id,profile,tools_level,tools_policy,tools_pending) values (c,engine_profile,level,policy,false)
  on conflict (company_id) do update set tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
end $$;
revoke all on function public.record_company_profile(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.record_company_profile(uuid,text,integer,integer) to service_role;

create function public.begin_company_tools(c uuid) returns void language sql security definer set search_path='' as $$
 update public.company_profiles set tools_pending=true where company_id=c;
$$;
revoke all on function public.begin_company_tools(uuid) from public,anon,authenticated;
grant execute on function public.begin_company_tools(uuid) to service_role;

-- Reservations keep their Agent, message and pinned profile, and say when they were abandoned. They point at their
-- Connection by id without a foreign key, so an abandoned one never keeps a Connection; an active one does (trigger).
alter table public.conversation_run_reservations drop constraint conversation_run_reservations_connection_id_fkey;
alter table public.conversation_run_reservations add column agent_id uuid, add column message text, add column profile text, add column abandoned_at timestamptz;

create function public.keep_reserved_connection() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.conversation_run_reservations r where r.connection_id=old.id and r.abandoned_at is null) then
  raise exception 'hermesProfileInUse' using errcode='23503'; end if;
 return old;
end $$;
revoke all on function public.keep_reserved_connection() from public,anon,authenticated,service_role;
create trigger reserved_connection_kept before delete on public.hermes_connections for each row execute function public.keep_reserved_connection();

drop function public.reserve_conversation_run(uuid,uuid,uuid,uuid);
create function public.reserve_conversation_run(conversation uuid, c uuid, agent uuid, message_key uuid, message text) returns uuid
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
  on conflict (conversation_id,send_key) do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null
   where public.conversation_run_reservations.abandoned_at is not null;
 return linked.id;
end $$;
revoke all on function public.reserve_conversation_run(uuid,uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.reserve_conversation_run(uuid,uuid,uuid,uuid,text) to authenticated;

-- The worker's one update: reservations whose message was not recorded within ten minutes, or that can never be
-- recorded (the Agent is gone, or the sender may no longer write in the company), are abandoned. Returns how many.
create function public.abandon_conversation_reservations() returns integer language sql security definer set search_path='' as $$
 with abandoned as (
  update public.conversation_run_reservations r set abandoned_at=now()
  where r.abandoned_at is null and (r.created_at<now()-interval '10 minutes'
   or not exists(select 1 from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id)
   or not exists(select 1 from public.members m where m.company_id=r.company_id and m.person_id=r.person_id and m.removed_at is null and m.role<>'viewer'))
  returning 1)
 select count(*)::integer from abandoned;
$$;
revoke all on function public.abandon_conversation_reservations() from public,anon,authenticated;
grant execute on function public.abandon_conversation_reservations() to service_role;

-- The move waits for every active reservation of its Connections, and for five quiet minutes; it removes an old
-- Connection only when no Agent and no active reservation uses it.
create or replace function public.move_company_profile(c uuid, bundled_address text, bundled_key text, bundled_version text, bundled_features text[]) returns integer
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
 if exists(select 1 from public.conversation_run_reservations r where r.connection_id=any(olds) and r.abandoned_at is null)
  or exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   join public.hermes_agents a on a.id=cv.agent_id and a.company_id=cv.company_id
   where a.company_id=c and a.connection_id=any(olds) and m.created_at>now()-interval '5 minutes')
  or exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
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
  delete from public.hermes_connections h where h.id=old and not exists(select 1 from public.hermes_agents a where a.connection_id=old)
   and not exists(select 1 from public.conversation_run_reservations r where r.connection_id=old and r.abandoned_at is null);
 end loop;
 return moved;
end $$;
revoke all on function public.move_company_profile(uuid,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.move_company_profile(uuid,text,text,text,text[]) to service_role;
