-- #120, ADR 0016: an Agent Lead makes gets its own profile in the bundled Engine, `ag-<agent id>`, with its instructions
-- as the profile's soul and the tools of its Company's Agent level. lib/agent-tools.mjs makes the profile through the
-- driver before the database makes the Agent; lead_create_agent then attaches the Agent to it when the Engine made it
-- with those tools and can answer for it, and to Lead's profile as before otherwise. The Agent's id is derived from the
-- Conversation, run and call, so a repeated or racing call names one profile and makes one Agent.
--
-- agent_profiles is the owner record of each such profile and the tool state the worker keeps in step with the Company's
-- level (lib/company-profiles.mjs), as company_profiles is for a Company's own. A Connection or an Agent naming an `ag-`
-- profile is refused unless that record names the same Agent and Company, whoever writes it, and every Run entry checks
-- it again with the profile's tools.
--
-- Nothing existing is rewritten: the new table starts empty and every Agent stays where it is. The previous app version
-- runs against this: its create calls make the Agent on Lead's profile (with a derived id), its worker no longer moves an
-- `ag-` Agent, and a Run it starts for one carries the Agent's instructions as well as the soul.

create table public.agent_profiles (
 agent_id uuid primary key,
 company_id uuid not null references public.companies(id),
 profile text generated always as ('ag-'||replace(agent_id::text,'-','')) stored unique,
 tools_level smallint check (tools_level between 1 and 3),
 tools_policy integer,
 tools_pending boolean not null default false,
 created_at timestamptz not null default now(),
 -- No tool state: the Engine must make the profile (again). The record outlives a lost profile, so the guards keep
 -- refusing every other Agent and Company while the worker makes it again.
 constraint agent_profiles_tools_whole check ((tools_level is null)=(tools_policy is null)),
 -- Deferred: lead_create_agent writes the record before the Connection and the Agent the guards check against it.
 constraint agent_profiles_agent foreign key (company_id,agent_id) references public.hermes_agents(company_id,id)
  on delete cascade deferrable initially deferred
);
alter table public.agent_profiles enable row level security;
revoke all on public.agent_profiles from anon,authenticated,service_role;

-- The run id is length-prefixed: run ids may hold ':' and the call id follows, so two calls never meet on one string.
create function public.lead_agent_id(conversation uuid, run text, call text) returns uuid language sql immutable set search_path='' as $$
 select md5('agent:'||conversation::text||':'||length(run)::text||':'||run||':'||call)::uuid;
$$;
revoke all on function public.lead_agent_id(uuid,text,text) from public,anon,authenticated,service_role;

-- 35 characters, a valid profile name (Hermes's PROFILE_ID_RE takes 64), the same as agent_profiles.profile.
create function public.agent_engine_profile(agent uuid) returns text language sql immutable set search_path='' as $$
 select 'ag-'||replace(agent::text,'-','');
$$;
revoke all on function public.agent_engine_profile(uuid) from public,anon,authenticated,service_role;

-- What Lead's call would make, read before the Engine is asked (lib/agent-tools.mjs): the profile name, the soul fitted to
-- the Company, and the Company's level. Nothing when the call already made its Agent, or the Conversation is not an
-- active Owner's with Lead, so a repeated call and a call that will be refused ask the Engine for nothing;
-- lead_create_agent still decides.
create function public.lead_agent_profile(conversation uuid, run text, call text, instructions text default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('profile',public.agent_engine_profile(public.lead_agent_id(conversation,run,call)),
  'soul',replace(instructions,'{company}',co.name),'level',co.agent_level)
 from public.conversations v join public.companies co on co.id=v.company_id
 where v.id=conversation and public.may_use_lead_tools(v.company_id,v.agent_id,v.person_id)
  and not exists(select 1 from public.lead_made_agents l where l.conversation_id=conversation and l.run_id=run and l.call_id=call);
$$;
revoke all on function public.lead_agent_profile(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.lead_agent_profile(uuid,text,text,text) to service_role;

-- The one function that makes an Agent for Lead's call (and for «Make it»), replaced with two more arguments: the level
-- and policy the Agent's own profile was made and read back under, given only when the Engine made it. Without them the
-- Agent is made on Lead's profile as before. The previous app version's call names the first six or eight arguments.
drop function public.lead_create_agent(uuid,text,text,text,text,text[],text,text);
create function public.lead_create_agent(conversation uuid, run text, call text, agent_name text, job text, apps text[], template text default null, instructions text default null,
 own_level integer default null, own_policy integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; linked public.hermes_connections; connection uuid; made uuid;
 agent uuid:=public.lead_agent_id(conversation,run,call);
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select l.agent_id into made from public.lead_made_agents l where l.conversation_id=conversation and l.run_id=run and l.call_id=call;
 if found then return jsonb_build_object('state','created','agent',made); end if;
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not (public.may_use_lead_tools(talk.company_id,talk.agent_id,talk.person_id)
   or exists(select 1 from public.lead_agent_requests r where r.conversation_id=conversation and r.run_id=run and r.call_id=call and r.state='made'
    and public.may_use_lead_tools(talk.company_id,talk.agent_id,r.answered_by))) then return jsonb_build_object('state','refused'); end if;
 if not public.agent_fields_valid(agent_name,job,apps,template,instructions) or (own_level is null)<>(own_policy is null) or own_level not between 1 and 3 then
  return jsonb_build_object('state','invalid'); end if;
 select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=talk.agent_id;
 -- The owner record comes first: the Connection naming the profile and the Agent on it are checked against it. Its tool
 -- state is what was read back, not today's level: a change meanwhile is work for the worker and holds its Runs.
 if own_level is not null then
  insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) values(agent,talk.company_id,own_level,own_policy);
 end if;
 insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state,version,features)
  values(talk.company_id,talk.person_id,linked.address,case when own_level is null then linked.profile else public.agent_engine_profile(agent) end,
   linked.key_encrypted,linked.state,linked.version,linked.features) returning id into connection;
 insert into public.hermes_agents(id,company_id,connection_id,name,speciality,requested_by,apps,template,instructions)
  values(agent,talk.company_id,connection,trim(agent_name),trim(job),talk.person_id,array(select trim(app) from unnest(apps) app),template,
   replace(instructions,'{company}',(select c.name from public.companies c where c.id=talk.company_id))) returning id into made;
 insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id) values(conversation,run,call,talk.company_id,made);
 insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
  values(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),made,'REQUEST_HERMES_AGENT',
   jsonb_strip_nulls(jsonb_build_object('connection_id',connection,'agent_name',trim(agent_name),'job',trim(job),'conversation_id',conversation,'template',template)));
 return jsonb_build_object('state','created','agent',made);
end $$;
revoke all on function public.lead_create_agent(uuid,text,text,text,text,text[],text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.lead_create_agent(uuid,text,text,text,text,text[],text,text,integer,integer) to service_role;

-- An `ag-` profile serves its one Agent in its one Company: a Connection naming it exists only in the Company its owner
-- record names, and only that Agent sits on it. This covers the Owner's paste route (any profile name), an attach after
-- the sharing confirmation (a new Agent, so another id), the service role and any later move.
create function public.guard_agent_profile_connection() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.profile ~ '^ag-[0-9a-f]{32}$' and not exists(select 1 from public.agent_profiles p where p.profile=new.profile and p.company_id=new.company_id) then
  raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_agent_profile_connection() from public,anon,authenticated,service_role;
create trigger agent_profile_connection before insert or update of profile,company_id on public.hermes_connections
 for each row execute function public.guard_agent_profile_connection();

create function public.guard_agent_profile_agent() returns trigger language plpgsql security definer set search_path='' as $$
declare named text;
begin
 select profile into named from public.hermes_connections where id=new.connection_id;
 if named ~ '^ag-[0-9a-f]{32}$' and not exists(select 1 from public.agent_profiles p where p.profile=named and p.agent_id=new.id and p.company_id=new.company_id) then
  raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_agent_profile_agent() from public,anon,authenticated,service_role;
create trigger agent_profile_agent before insert or update of id,connection_id,company_id on public.hermes_agents
 for each row execute function public.guard_agent_profile_agent();

-- Why no Run may start for this Agent on this Connection's profile now: hermesProfileNotShared when it names an Agent
-- profile that is not this Agent's in this Company, agentLevelPending while that profile's tools are not those of the
-- Company's level and policy, read back. Null for any other profile.
create function public.agent_profile_refusal(engine_profile text, c uuid, agent uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
  when coalesce(engine_profile,'') !~ '^ag-[0-9a-f]{32}$' then null
  when not exists(select 1 from public.agent_profiles p where p.profile=engine_profile and p.agent_id=agent and p.company_id=c) then 'hermesProfileNotShared'
  when not exists(select 1 from public.agent_profiles p join public.companies co on co.id=p.company_id
   where p.agent_id=agent and p.tools_level=co.agent_level and p.tools_policy=public.engine_tool_policy() and not p.tools_pending) then 'agentLevelPending'
 end;
$$;
revoke all on function public.agent_profile_refusal(text,uuid,uuid) from public,anon,authenticated,service_role;

-- Every Run entry checks it: 20261211000002's reservation, 20261215000000's claim, 20261219000000's channel start and
-- 20261224000000's note start, each unchanged but for these lines.
create or replace function public.reserve_conversation_run(conversation uuid, c uuid, agent uuid, message_key uuid, message text) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing public.conversations; held public.conversation_run_reservations; linked public.hermes_connections; refusal text;
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
 refusal:=public.agent_profile_refusal(linked.profile,c,agent);
 if refusal='hermesProfileNotShared' then raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 if refusal='agentLevelPending' then raise exception 'agentLevelPending' using errcode='55000'; end if;
 insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
  values(conversation,message_key,c,linked.id,auth.uid(),agent,message,linked.profile)
  on conflict (conversation_id,send_key) do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null,
   start_attempts=0,start_unknown_at=null
   where public.conversation_run_reservations.abandoned_at is not null;
 return linked.id;
end $$;

-- A claim reads the Conversation's open run and its next turn only after a start being recorded has ended (#70).
create or replace function public.claim_conversation_turn(conversation uuid)
returns table(company uuid, agent uuid, person uuid, send_key uuid, message text, connection uuid, note text, retry boolean)
language plpgsql security definer set search_path='' as $$
declare turn public.conversation_queued_turns; linked public.hermes_connections; held public.conversation_run_reservations; uncertain boolean; refusal text;
begin
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 -- The agents lock comes before anything is read: a turn's start is recorded under it (record_conversation_turn), and a
 -- claim that met a record half done read the recorded turn as still waiting and reserved it again; nothing cleared
 -- that reservation, and it held up every later turn of the Conversation (#70). The order stays turns first.
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if exists(select 1 from public.conversation_open_run(conversation)) then return; end if;
 select q.* into turn from public.conversation_queued_turns q where q.conversation_id=conversation and q.started_at is null and q.failed_at is null
  order by exists(select 1 from public.conversation_run_reservations r where r.conversation_id=q.conversation_id and r.send_key=q.send_key and r.abandoned_at is null) desc,q.queued_at,q.send_key limit 1;
 if not found then return; end if;
 -- Its message was recorded meanwhile (the direct send's late record of a start once marked unknown): it already ran.
 if exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.send_key=turn.send_key and m.author='person') then
  perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
  update public.conversation_queued_turns q set started_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key;
  delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=turn.send_key and r.abandoned_at is null;
  return;
 end if;
 if exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.abandoned_at is null and r.send_key<>turn.send_key) then return; end if;
 if not exists(select 1 from public.members m where m.company_id=turn.company_id and m.person_id=turn.person_id and m.removed_at is null and m.role<>'viewer')
  or not exists(select 1 from public.conversations cv where cv.id=conversation and cv.agent_id=turn.agent_id) then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=turn.send_key and r.abandoned_at is null;
 uncertain:=held.conversation_id is not null and (held.start_unknown_at is not null or held.start_attempts>0);
 if held.conversation_id is not null then select * into linked from public.hermes_connections h where h.id=held.connection_id;
 else select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=turn.agent_id and a.company_id=turn.company_id;
 end if;
 refusal:=public.agent_profile_refusal(linked.profile,turn.company_id,turn.agent_id);
 -- A start that may have happened is never failed here: it waits for its own Connection to be usable again.
 if (linked.id is null or (linked.profile ~ '^co-[0-9a-f]{32}$' and linked.profile<>public.company_engine_profile(turn.company_id)) or refusal='hermesProfileNotShared') and not uncertain then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 if linked.id is null then return; end if;
 if ((linked.profile ~ '^co-[0-9a-f]{32}$' and not public.company_profile_ready(turn.company_id)) or refusal='agentLevelPending') and not uncertain then return; end if;
 if held.conversation_id is null then
  insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
   values(conversation,turn.send_key,turn.company_id,linked.id,turn.person_id,turn.agent_id,turn.message,linked.profile)
   on conflict on constraint conversation_run_reservations_pkey do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null,
    start_attempts=0,start_unknown_at=null
    where public.conversation_run_reservations.abandoned_at is not null;
 end if;
 return query select turn.company_id,turn.agent_id,turn.person_id,turn.send_key,turn.message,linked.id,
  public.pinned_run_note(conversation,turn.send_key,turn.company_id,turn.person_id),uncertain;
end $$;

create or replace function public.begin_channel_start(message bigint)
returns table(attempt integer, company uuid, connection uuid, session uuid, input text, instructions text, rules text[])
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs; linked public.hermes_connections;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.channel_runs where message_id=message for update;
 if r.message_id is null or r.outcome is not null or r.run_id is not null then return; end if;
 -- Never started: given up after ten minutes. May have started: given up after a day, as ADR 0015 gives up a start
 -- whose answer was lost.
 if r.attempts = 0 and r.created_at < now()-interval '10 minutes' then perform public.close_channel_run(message,null,'failed',null,null,null); return; end if;
 if r.attempts > 0 and r.created_at < now()-interval '1 day' then perform public.close_channel_run(message,null,'lost',null,null,null); return; end if;
 if r.attempts = 0 then
  select a.connection_id into r.connection_id from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id;
  if r.connection_id is null then perform public.close_channel_run(message,null,'failed',null,null,null); return; end if;
 elsif r.connection_id is null then
  perform public.close_channel_run(message,null,'lost',null,null,null); return;
 end if;
 select * into linked from public.hermes_connections where id=r.connection_id;
 -- ADR 0014: a Company profile serves its own Company, and no Run starts while its tools are pending. Waiting returns
 -- nothing; the deadlines above end the wait.
 if linked.profile ~ '^co-[0-9a-f]{32}$' and (linked.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 -- ADR 0016: an Agent profile serves its own Agent, on the same terms.
 if public.agent_profile_refusal(linked.profile,r.company_id,r.agent_id) is not null then return; end if;
 update public.channel_runs set attempts=attempts+1, attempted_at=now(), connection_id=r.connection_id
  where message_id=message returning attempts into r.attempts;
 return query select r.attempts, r.company_id, r.connection_id, r.session, r.input, r.instructions, r.rules;
end $$;

create or replace function public.begin_note_start(message bigint)
returns table(attempt integer, company uuid, connection uuid, session uuid, input text, instructions text, rules text[])
language plpgsql security definer set search_path='' as $$
declare r public.note_runs; linked public.hermes_connections;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.note_runs where note_id=message for update;
 if r.note_id is null or r.outcome is not null or r.run_id is not null then return; end if;
 if r.attempts = 0 and r.created_at < now()-interval '10 minutes' then perform public.close_note_run(message,null,'failed',null,null,null); return; end if;
 if r.attempts > 0 and r.created_at < now()-interval '1 day' then perform public.close_note_run(message,null,'lost',null,null,null); return; end if;
 if r.attempts = 0 then
  select a.connection_id into r.connection_id from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id;
  if r.connection_id is null then perform public.close_note_run(message,null,'failed',null,null,null); return; end if;
 elsif r.connection_id is null then
  perform public.close_note_run(message,null,'lost',null,null,null); return;
 end if;
 select * into linked from public.hermes_connections where id=r.connection_id;
 if linked.profile ~ '^co-[0-9a-f]{32}$' and (linked.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 if public.agent_profile_refusal(linked.profile,r.company_id,r.agent_id) is not null then return; end if;
 update public.note_runs set attempts=attempts+1, attempted_at=now(), connection_id=r.connection_id
  where note_id=message returning attempts into r.attempts;
 return query select r.attempts, r.company_id, r.connection_id, r.session, r.input, r.instructions, r.rules;
end $$;

-- An `ag-` Connection is bundled (its REQUEST_HERMES_AGENT row names it), so the Company's work names the exclusion: an
-- Agent on its own profile is never moved to the Company's. 20261210000002's work and 20261224000000's move, each
-- unchanged but for that line.
create or replace function public.company_profile_work() returns table(company_id uuid, profile text, agent_level smallint, tools_level smallint, tools_policy integer, tools_pending boolean, attach boolean, move boolean)
language sql stable security definer set search_path='' as $$
 select w.id,public.company_engine_profile(w.id),w.agent_level,w.tools_level,w.tools_policy,coalesce(w.tools_pending,false),w.attach,w.move from (
  select c.id,c.agent_level,p.tools_level,p.tools_policy,p.tools_pending,p.company_id is not null as recorded,
   p.company_id is null and exists(select 1 from public.hermes_connections h where h.company_id=c.id and h.profile=public.company_engine_profile(c.id) and public.is_bundled_connection(h.id)) as lost,
   not exists(select 1 from public.hermes_connections h where h.company_id=c.id) and not exists(select 1 from public.hermes_agents a where a.company_id=c.id) as attach,
   exists(select 1 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id
    where a.company_id=c.id and h.profile<>public.company_engine_profile(c.id) and h.profile !~ '^ag-[0-9a-f]{32}$' and public.is_bundled_connection(h.id)) as move
  from public.companies c left join public.company_profiles p on p.company_id=c.id
  where exists(select 1 from public.members m where m.company_id=c.id and m.role='owner' and m.removed_at is null)) w
 where w.attach or w.move or w.lost
  or (w.recorded and (w.tools_level<>w.agent_level or w.tools_policy is distinct from public.engine_tool_policy() or w.tools_pending))
 -- A company that only waits to move may wait long (for its own sign-in): those come after every company with other work,
 -- in an order that turns every minute, so a hundred of them never hold back a company to provision, nor each other.
 order by (w.move and not w.attach and not w.lost and not (w.recorded and (w.tools_level<>w.agent_level or w.tools_policy is distinct from public.engine_tool_policy() or w.tools_pending))),
  case when w.move and not w.attach and not w.lost then md5(w.id::text||date_trunc('minute',now())::text) end,w.id
 limit 100;
$$;

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
  where a.company_id=c and h.profile<>public.company_engine_profile(c) and h.profile !~ '^ag-[0-9a-f]{32}$' and public.is_bundled_connection(h.id));
 if exists(select 1 from public.conversation_run_reservations r where r.connection_id=any(olds) and r.abandoned_at is null)
  or exists(select 1 from public.channel_runs r where r.connection_id=any(olds) and r.outcome is null)
  or exists(select 1 from public.note_runs r where r.connection_id=any(olds) and r.outcome is null)
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

-- Tool health read "unknown profile" for a bundled Connection (lib/company-profiles.mjs checkAgentTools): an Agent profile
-- the Engine lost keeps its owner record and loses its tool state, so the worker makes it again, empty, and no Run starts
-- on it meanwhile. 20261210000000's forget, unchanged but for that.
create or replace function public.forget_company_profile(connection uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare forgot boolean;
begin
 delete from public.company_profiles p using public.hermes_connections h
  where h.id=connection and p.company_id=h.company_id and p.profile=h.profile and public.is_bundled_connection(h.id);
 forgot:=found;
 update public.agent_profiles p set tools_level=null,tools_policy=null,tools_pending=false from public.hermes_connections h
  where h.id=connection and p.profile=h.profile and p.company_id=h.company_id and p.tools_level is not null and public.is_bundled_connection(h.id);
 return forgot or found;
end $$;

-- The worker's list of Agent profiles whose tools are not those of their Company's level and policy, confirmed: the lost
-- ones (no tool state) first, then the rest in an order that turns every minute, so a hundred failing ones never hold
-- back the others. Each comes with the Agent's instructions, the soul a lost one is made again with.
create function public.agent_profile_work() returns table(agent_id uuid, profile text, agent_level smallint, tools_level smallint, tools_policy integer, tools_pending boolean, instructions text)
language sql stable security definer set search_path='' as $$
 select p.agent_id,p.profile,co.agent_level,p.tools_level,p.tools_policy,p.tools_pending,a.instructions
 from public.agent_profiles p join public.hermes_agents a on a.id=p.agent_id and a.company_id=p.company_id
  join public.companies co on co.id=p.company_id
 where p.tools_level is null or p.tools_level<>co.agent_level or p.tools_policy is distinct from public.engine_tool_policy() or p.tools_pending
 order by p.tools_level is not null,md5(p.agent_id::text||date_trunc('minute',now())::text)
 limit 100;
$$;
revoke all on function public.agent_profile_work() from public,anon,authenticated;
grant execute on function public.agent_profile_work() to service_role;

-- Marked as changing before the worker writes the tools, so no Run starts on them until their read-back is recorded.
create function public.begin_agent_tools(agent uuid) returns void language sql security definer set search_path='' as $$
 update public.agent_profiles set tools_pending=true where agent_id=agent;
$$;
revoke all on function public.begin_agent_tools(uuid) from public,anon,authenticated;
grant execute on function public.begin_agent_tools(uuid) to service_role;

-- Only lead_create_agent writes an owner record; the worker records the tools it read back on one that exists.
create function public.record_agent_profile(agent uuid, engine_profile text, level integer, policy integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if engine_profile is distinct from public.agent_engine_profile(agent) or level is null or level not between 1 and 3 or policy is distinct from public.engine_tool_policy() then
  raise exception 'agentProfileInvalid' using errcode='22023'; end if;
 update public.agent_profiles set tools_level=level,tools_policy=policy,tools_pending=false where agent_id=agent;
end $$;
revoke all on function public.record_agent_profile(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.record_agent_profile(uuid,text,integer,integer) to service_role;
