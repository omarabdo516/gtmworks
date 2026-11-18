-- #342: the bundled Hermes is the only Hermes (ADR 0010, 0014, 0016; ADR 0008's pasted Connections are superseded).
-- Each Agent names its own profile on it; the app and the worker take the Hermes address and key from the install's
-- environment, never from a row. Dropped (no data copy, decision 0042): hermes_connections, hermes_agent_audit (an Agent
-- change is written to the company log directly), the previous version's bundled provider and every guard of a
-- Connection. Agents that ran on a pasted Hermes are removed. A Company still on the shared `default` profile is moved
-- to its own by the worker, as before (company_profile_work, move_company_profile). Every function redefined here starts
-- from its body after 20270212.

-- An Agent change goes to the company log as the audit trigger wrote it, numbered after every audit row there was.
create sequence public.agent_log_ids;
select setval('public.agent_log_ids',greatest(coalesce((select max(id) from public.hermes_agent_audit),0),
 coalesce((select max(source_id) from public.company_log where source='hermes_agent_audit'),0))+1,false);
revoke all on sequence public.agent_log_ids from public,anon,authenticated,service_role;
create function public.log_agent_event(c uuid, actor uuid, actor_name text, agent uuid, act text, details jsonb)
 returns void language sql security definer set search_path='' as $$
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,actor,public.log_actor_kind(c,actor),coalesce(actor_name,(select name from public.people where id=actor)),
   'agent',agent,public.log_agent_action(act),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=agent),'replacement_id',details->'replacement_id','job',details->'job','rule',details->'rule','taught_by',details->'taught_by','asked_for',details->'asked_for','asked_by',details->'asked_by','reason',details->'reason','private',details->'private','teller',details->'teller')),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
$$;
revoke all on function public.log_agent_event(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated,service_role;

-- Each Agent's profile, from its bundled Connection. One on a pasted Hermes has none and is removed, with what was only
-- its (cascades as the Agent's own removal does); a reservation on a pasted Connection holds nothing.
alter table public.hermes_agents add column profile text;
update public.hermes_agents a set profile=h.profile from public.hermes_connections h where h.id=a.connection_id and public.is_bundled_connection(h.id);
update public.conversation_run_reservations r set profile=h.profile from public.hermes_connections h
 where h.id=r.connection_id and r.profile is null and public.is_bundled_connection(h.id);
delete from public.conversation_run_reservations r where not public.is_bundled_connection(r.connection_id);
delete from public.hermes_agents where profile is null;
-- connection_id stays as the Agent's own id for its face (components/agent-face.tsx) and its Runs' pin; it names no row.
alter table public.hermes_agents alter column profile set not null, alter column connection_id set default gen_random_uuid(),
 add constraint hermes_agents_profile_name check (profile ~ '^[a-zA-Z0-9_-]{1,100}$');
grant select(profile) on public.hermes_agents to service_role;
-- A channel's and a note's Run keep the profile they started on, as a reservation does.
alter table public.channel_runs add column profile text;
alter table public.note_runs add column profile text;
update public.channel_runs r set profile=h.profile from public.hermes_connections h where h.id=r.connection_id and public.is_bundled_connection(h.id);
update public.note_runs r set profile=h.profile from public.hermes_connections h where h.id=r.connection_id and public.is_bundled_connection(h.id);

-- The guards of an Agent's profile read its own column now.
create or replace function public.guard_agent_profile_agent() returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if new.profile ~ '^ag-[0-9a-f]{32}$' and not exists(select 1 from public.agent_profiles p where p.profile=new.profile and p.agent_id=new.id and p.company_id=new.company_id) then
  raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 return new;
end $function$;
create or replace function public.guard_company_profile_agent() returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if new.profile ~ '^co-[0-9a-f]{32}$' and new.profile<>public.company_engine_profile(new.company_id) then raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 return new;
end $function$;
create or replace function public.guard_shared_space_agent() returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if new.profile ~ '^cs-[0-9a-f]{32}$' then raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 return new;
end $function$;
drop trigger agent_profile_agent on public.hermes_agents;
drop trigger company_profile_agent on public.hermes_agents;
drop trigger shared_space_agent on public.hermes_agents;
create trigger agent_profile_agent before insert or update of id,profile,company_id on public.hermes_agents for each row execute function public.guard_agent_profile_agent();
create trigger company_profile_agent before insert or update of profile,company_id on public.hermes_agents for each row execute function public.guard_company_profile_agent();
create trigger shared_space_agent before insert or update of profile on public.hermes_agents for each row execute function public.guard_shared_space_agent();

create or replace function public.agent_may_move(agent uuid) returns boolean language sql stable security definer set search_path='' as $function$
 select exists(select 1 from public.hermes_agents a
  where a.id=agent and a.profile=public.company_engine_profile(a.company_id)
   and a.id is distinct from public.company_profile_keeper(a.company_id)
   and exists(select 1 from public.members m where m.company_id=a.company_id and m.role='owner' and m.removed_at is null));
$function$;

create or replace function public.begin_agent_profile_move(agent uuid) returns boolean language plpgsql security definer set search_path='' as $function$
declare moving public.hermes_agents;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into moving from public.hermes_agents where id=agent;
 if not found or moving.profile<>public.company_engine_profile(moving.company_id) then return false; end if;
 insert into public.company_profile_keepers(company_id,agent_id) values(moving.company_id,public.company_profile_keeper(moving.company_id))
  on conflict (company_id) do nothing;
 if not public.agent_may_move(agent) then return false; end if;
 insert into public.agent_profiles(agent_id,company_id) values(agent,moving.company_id) on conflict (agent_id) do nothing;
 return true;
end $function$;

-- The worker's Hermes environment is the address and the key: attaching and moving a Company take only the Company.
drop function public.attach_company_profile(uuid,text,text,text,text[]);
create function public.attach_company_profile(c uuid) returns boolean language plpgsql security definer set search_path='' as $function$
declare first_owner uuid; agent uuid;
begin
 -- The same lock as agent assignments: a company is provided once, even with a second worker.
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if not public.company_profile_ready(c) or exists(select 1 from public.hermes_agents a where a.company_id=c) then return false; end if;
 select m.person_id into first_owner from public.members m where m.company_id=c and m.role='owner' and m.removed_at is null order by m.person_id limit 1;
 if first_owner is null then return false; end if;
 insert into public.hermes_agents(company_id,profile,name,speciality,is_default) values(c,public.company_engine_profile(c),'Lead','General',true) returning id into agent;
 perform public.log_agent_event(c,first_owner,null,agent,'PROVIDE_BUNDLED_HERMES_AGENT','{}');
 return true;
end $function$;
revoke all on function public.attach_company_profile(uuid) from public,anon,authenticated;
grant execute on function public.attach_company_profile(uuid) to service_role;

drop function public.move_company_profile(uuid,text,text,text,text[]);
create function public.move_company_profile(c uuid) returns integer language plpgsql security definer set search_path='' as $function$
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
    and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)) then
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

create or replace function public.move_agent_profile(agent uuid) returns boolean language plpgsql security definer set search_path='' as $function$
declare moving public.hermes_agents; first_owner uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into moving from public.hermes_agents where id=agent;
 if not found or not public.company_profile_ready(moving.company_id) or not public.agent_may_move(agent) or public.agent_move_blocked(agent)
  or not exists(select 1 from public.agent_profiles p join public.companies co on co.id=p.company_id where p.agent_id=agent and p.company_id=moving.company_id
   and p.tools_level=co.agent_level and p.tools_policy=public.engine_tool_policy() and not p.tools_pending and (p.skills_shared or not public.shared_skills_active(moving.company_id))) then return false; end if;
 select m.person_id into first_owner from public.members m where m.company_id=moving.company_id and m.role='owner' and m.removed_at is null order by m.person_id limit 1;
 update public.hermes_agents set profile=public.agent_engine_profile(agent),connection_id=gen_random_uuid() where id=agent;
 perform public.log_agent_event(moving.company_id,first_owner,null,agent,'MOVE_AGENT_PROFILE','{}');
 return true;
end $function$;

drop function public.begin_channel_start(bigint);
create function public.begin_channel_start(message bigint)
 returns table(attempt integer, company uuid, profile text, session uuid, input text, instructions text, rules text[])
 language plpgsql security definer set search_path='' as $function$
declare r public.channel_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.channel_runs where message_id=message for update;
 if r.message_id is null or r.outcome is not null or r.run_id is not null then return; end if;
 -- Never started: given up after ten minutes. May have started: given up after a day, as ADR 0015 gives up a start
 -- whose answer was lost.
 if r.attempts = 0 and r.created_at < now()-interval '10 minutes' then perform public.close_channel_run(message,null,'failed',null,null,null); return; end if;
 if r.attempts > 0 and r.created_at < now()-interval '1 day' then perform public.close_channel_run(message,null,'lost',null,null,null); return; end if;
 if r.attempts = 0 then
  select a.connection_id,a.profile into r.connection_id,r.profile from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id;
  if r.profile is null then perform public.close_channel_run(message,null,'failed',null,null,null); return; end if;
 elsif r.profile is null then
  perform public.close_channel_run(message,null,'lost',null,null,null); return;
 end if;
 -- ADR 0014: a Company profile serves its own Company, and no Run starts while its tools are pending. Waiting returns
 -- nothing; the deadlines above end the wait.
 if r.profile ~ '^co-[0-9a-f]{32}$' and (r.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 -- ADR 0016: an Agent profile serves its own Agent, on the same terms.
 if public.agent_profile_refusal(r.profile,r.company_id,r.agent_id) is not null then return; end if;
 update public.channel_runs set attempts=attempts+1, attempted_at=now(), connection_id=r.connection_id, profile=r.profile
  where message_id=message returning attempts into r.attempts;
 return query select r.attempts, r.company_id, r.profile, r.session, r.input, r.instructions, r.rules;
end $function$;
revoke all on function public.begin_channel_start(bigint) from public,anon,authenticated;
grant execute on function public.begin_channel_start(bigint) to service_role;

drop function public.begin_note_start(bigint);
create function public.begin_note_start(message bigint)
 returns table(attempt integer, company uuid, profile text, session uuid, input text, instructions text, rules text[])
 language plpgsql security definer set search_path='' as $function$
declare r public.note_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.note_runs where note_id=message for update;
 if r.note_id is null or r.outcome is not null or r.run_id is not null then return; end if;
 if r.attempts = 0 and r.created_at < now()-interval '10 minutes' then perform public.close_note_run(message,null,'failed',null,null,null); return; end if;
 if r.attempts > 0 and r.created_at < now()-interval '1 day' then perform public.close_note_run(message,null,'lost',null,null,null); return; end if;
 if r.attempts = 0 then
  select a.connection_id,a.profile into r.connection_id,r.profile from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id;
  if r.profile is null then perform public.close_note_run(message,null,'failed',null,null,null); return; end if;
 elsif r.profile is null then
  perform public.close_note_run(message,null,'lost',null,null,null); return;
 end if;
 if r.profile ~ '^co-[0-9a-f]{32}$' and (r.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 if public.agent_profile_refusal(r.profile,r.company_id,r.agent_id) is not null then return; end if;
 update public.note_runs set attempts=attempts+1, attempted_at=now(), connection_id=r.connection_id, profile=r.profile
  where note_id=message returning attempts into r.attempts;
 return query select r.attempts, r.company_id, r.profile, r.session, r.input, r.instructions, r.rules;
end $function$;
revoke all on function public.begin_note_start(bigint) from public,anon,authenticated;
grant execute on function public.begin_note_start(bigint) to service_role;

drop function public.channel_runs_due(uuid,bigint,bigint);
create function public.channel_runs_due(just_channel uuid default null, just_message bigint default null, after bigint default 0)
 returns table(message bigint, run text, profile text) language sql stable security definer set search_path='' as $function$
 select r.message_id, r.run_id, r.profile from public.channel_runs r
 where r.outcome is null and r.message_id > coalesce(after, 0)
  and (just_channel is null or r.channel_id=just_channel) and (just_message is null or r.message_id=just_message)
  and (r.run_id is not null or r.message_id=just_message
   or (r.attempts = 0 and r.created_at < now()-interval '1 minute') or (r.attempts > 0 and r.attempted_at < now()-interval '30 seconds'))
 order by r.message_id limit 500;
$function$;
revoke all on function public.channel_runs_due(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.channel_runs_due(uuid,bigint,bigint) to service_role;

drop function public.note_runs_due(bigint,bigint);
create function public.note_runs_due(just_message bigint default null, after bigint default 0)
 returns table(message bigint, run text, profile text) language sql stable security definer set search_path='' as $function$
 select r.note_id, r.run_id, r.profile from public.note_runs r
 where r.outcome is null and r.note_id > coalesce(after, 0) and (just_message is null or r.note_id=just_message)
  and (r.run_id is not null or r.note_id=just_message
   or (r.attempts = 0 and r.created_at < now()-interval '1 minute') or (r.attempts > 0 and r.attempted_at < now()-interval '30 seconds'))
 order by r.note_id limit 500;
$function$;
revoke all on function public.note_runs_due(bigint,bigint) from public,anon,authenticated;
grant execute on function public.note_runs_due(bigint,bigint) to service_role;

-- A Conversation's Run is pinned to its Agent's profile of the moment, under the Agent's connection_id as the token a
-- send names (started_on). A move gives the Agent a new one, as a new Connection row did, so a start made before a move
-- never records after it.
drop function public.claim_conversation_turn(uuid);
create function public.claim_conversation_turn(conversation uuid)
 returns table(company uuid, agent uuid, person uuid, send_key uuid, message text, connection uuid, profile text, note text, retry boolean)
 language plpgsql security definer set search_path='' as $function$
declare turn public.conversation_queued_turns; held public.conversation_run_reservations; uncertain boolean; refusal text; target text; token uuid;
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
 if held.conversation_id is not null then target:=held.profile; token:=held.connection_id;
 else select a.profile,a.connection_id into target,token from public.hermes_agents a where a.id=turn.agent_id and a.company_id=turn.company_id;
 end if;
 refusal:=public.agent_profile_refusal(target,turn.company_id,turn.agent_id);
 -- A start that may have happened is never failed here: it waits for its own profile to be usable again.
 if (target is null or (target ~ '^co-[0-9a-f]{32}$' and target<>public.company_engine_profile(turn.company_id)) or refusal='hermesProfileNotShared') and not uncertain then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 if target is null then return; end if;
 if ((target ~ '^co-[0-9a-f]{32}$' and not public.company_profile_ready(turn.company_id)) or refusal='agentLevelPending') and not uncertain then return; end if;
 if held.conversation_id is null then
  insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
   values(conversation,turn.send_key,turn.company_id,token,turn.person_id,turn.agent_id,turn.message,target)
   on conflict on constraint conversation_run_reservations_pkey do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null,
    start_attempts=0,start_unknown_at=null
    where public.conversation_run_reservations.abandoned_at is not null;
 end if;
 return query select turn.company_id,turn.agent_id,turn.person_id,turn.send_key,turn.message,token,target,
  public.pinned_run_note(conversation,turn.send_key,turn.company_id,turn.person_id),uncertain;
end $function$;
revoke all on function public.claim_conversation_turn(uuid) from public,anon,authenticated;
grant execute on function public.claim_conversation_turn(uuid) to service_role;

create or replace function public.reserve_conversation_run(conversation uuid, c uuid, agent uuid, message_key uuid, message text)
 returns uuid language plpgsql security definer set search_path='' as $function$
declare existing public.conversations; held public.conversation_run_reservations; target text; token uuid; refusal text;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if message is null or length(message) not between 1 and 200000 then raise exception 'conversationNotFound' using errcode='22023'; end if;
 select * into existing from public.conversations where id=conversation;
 if found and (existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is distinct from agent) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key;
 if found and (held.person_id<>auth.uid() or held.company_id<>c or held.agent_id is distinct from agent) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 -- A retry keeps the profile it first reserved, so it never starts a run on another profile; an abandoned one is
 -- reserved again on the Agent's profile of now. Either way the checks below run before it is returned.
 if found and held.abandoned_at is null then target:=held.profile; token:=held.connection_id;
 else select a.profile,a.connection_id into target,token from public.hermes_agents a where a.id=agent and a.company_id=c;
 end if;
 if target is null then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if target ~ '^co-[0-9a-f]{32}$' then
  if target<>public.company_engine_profile(c) then raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
  if not public.company_profile_ready(c) then raise exception 'agentLevelPending' using errcode='55000'; end if;
 end if;
 refusal:=public.agent_profile_refusal(target,c,agent);
 if refusal='hermesProfileNotShared' then raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 if refusal='agentLevelPending' then raise exception 'agentLevelPending' using errcode='55000'; end if;
 insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
  values(conversation,message_key,c,token,auth.uid(),agent,message,target)
  on conflict (conversation_id,send_key) do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null,
   start_attempts=0,start_unknown_at=null
   where public.conversation_run_reservations.abandoned_at is not null;
 return token;
end $function$;

create or replace function public.record_conversation_turn(conversation uuid, message_key uuid, run text, started_on uuid)
 returns boolean language plpgsql security definer set search_path='' as $function$
declare turn public.conversation_queued_turns; held public.conversation_run_reservations; chosen public.hermes_agents; writer text; saved bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into turn from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=message_key;
 if not found or run is null then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if turn.started_at is not null then return false; end if;
 -- Its message was already stored by the direct send's late record: the turn ran; it is started, never failed.
 if exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.send_key=message_key and m.author='person') then
  update public.conversation_queued_turns q set started_at=now() where q.conversation_id=conversation and q.send_key=message_key;
  delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null;
  return false;
 end if;
 select * into chosen from public.hermes_agents a where a.id=turn.agent_id and a.company_id=turn.company_id;
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key;
 if chosen.id is null or held.conversation_id is null or held.abandoned_at is not null or started_on is null or held.connection_id<>started_on or held.profile is distinct from chosen.profile then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=message_key;
  delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null;
  return false;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation_run:'||run,0));
 if exists(select 1 from public.conversation_messages m where m.author='person' and m.run_id=run and m.conversation_id<>conversation) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select name into writer from public.people where id=turn.person_id;
 insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
  values(turn.company_id,conversation,'person',turn.person_id,coalesce(writer,''),turn.message,message_key,run) on conflict do nothing returning id into saved;
 delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key;
 update public.conversation_queued_turns q set started_at=now() where q.conversation_id=conversation and q.send_key=message_key;
 return saved is not null;
end $function$;

create or replace function public.send_conversation_message(conversation uuid, c uuid, agent uuid, message text, message_key uuid, run text, started_on uuid)
 returns boolean language plpgsql security definer set search_path='' as $function$
declare existing public.conversations; chosen public.hermes_agents; held public.conversation_run_reservations; writer text; saved bigint;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into chosen from public.hermes_agents where id=agent and company_id=c;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key;
 if found and (held.abandoned_at is not null or started_on is null or held.connection_id<>started_on or held.profile is distinct from chosen.profile) then
  raise exception 'conversationSendAgain' using errcode='55000'; end if;
 insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),agent,chosen.name) on conflict (id) do nothing;
 select * into existing from public.conversations where id=conversation;
 if existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is distinct from agent then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 -- A Member cannot register a run that belongs to another conversation: each copy would be closed again and its
 -- engine usage counted twice. The lock keeps two calls at once from both passing. A retry in the same conversation
 -- stays idempotent.
 perform pg_advisory_xact_lock(hashtextextended('conversation_run:'||coalesce(run,''),0));
 if exists(select 1 from public.conversation_messages where author='person' and run_id=run and conversation_id<>conversation) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select name into writer from public.people where id=auth.uid();
 insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
  values(c,conversation,'person',auth.uid(),coalesce(writer,''),message,message_key,run) on conflict do nothing returning id into saved;
 delete from public.conversation_run_reservations where conversation_id=conversation and send_key=message_key;
 return saved is not null;
end;
$function$;

drop function public.conversation_stop_target(uuid,uuid);
create function public.conversation_stop_target(conversation uuid, c uuid) returns table(run text, profile text)
 language plpgsql stable security definer set search_path='' as $function$
declare running record; named text;
begin
 if auth.uid() is null or not public.is_member(c) or not exists(select 1 from public.conversations cv where cv.id=conversation and cv.company_id=c)
  or not public.can_see_conversation_agent(c,conversation) then
  raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into running from public.conversation_open_run(conversation);
 if running.run is null then raise exception 'conversationNothingToStop' using errcode='P0002'; end if;
 if running.person<>auth.uid() and not public.can_manage_company(c) then raise exception 'conversationStopNotAllowed' using errcode='42501'; end if;
 select a.profile into named from public.conversations cv join public.hermes_agents a on a.id=cv.agent_id and a.company_id=cv.company_id where cv.id=conversation;
 return query select running.run,named;
end $function$;
revoke all on function public.conversation_stop_target(uuid,uuid) from public,anon,service_role;
grant execute on function public.conversation_stop_target(uuid,uuid) to authenticated;

drop function public.open_conversation_runs(uuid,uuid,bigint);
create function public.open_conversation_runs(just uuid default null, owner uuid default null, after bigint default 0)
 returns table(message bigint, conversation uuid, run text, person uuid, profile text) language sql stable security definer set search_path='' as $function$
 select m.id,m.conversation_id,m.run_id,c.person_id,a.profile from public.conversation_messages m
 join public.conversations c on c.id=m.conversation_id left join public.hermes_agents a on a.id=c.agent_id and a.company_id=c.company_id
 where m.author='person' and m.id>after and (just is null or m.conversation_id=just) and (owner is null or c.person_id=owner)
  and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
  and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)
 order by m.id limit 500;
$function$;
revoke all on function public.open_conversation_runs(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.open_conversation_runs(uuid,uuid,bigint) to service_role;

create or replace function public.bundled_engine_shared(c uuid) returns boolean language sql stable security definer set search_path='' as $function$
 select public.is_company_owner(c)
  and exists(select 1 from public.hermes_agents a join public.hermes_agents o on o.profile=a.profile and o.company_id<>a.company_id
   where a.company_id=c and a.profile !~ '^(co|ag|cs)-[0-9a-f]{32}$');
$function$;

create or replace function public.company_app_agents(c uuid)
 returns table(agent uuid, name text, connection uuid, profile text, main boolean, own boolean) language sql stable security definer set search_path='' as $function$
 select a.id,a.name,a.connection_id,a.profile,a.is_default,
  (a.profile=p.profile and a.id=public.company_profile_keeper(c))
   or exists(select 1 from public.agent_profiles g where g.agent_id=a.id and g.company_id=c and g.profile=a.profile)
 from public.hermes_agents a join public.company_profiles p on p.company_id=c
 where a.company_id=c and public.can_see_agent(c,a.id)
  and (a.profile=p.profile or a.profile=public.agent_engine_profile(a.id))
 order by a.is_default desc,a.name,a.id;
$function$;

drop function public.company_engine_target(uuid);
create function public.company_engine_target(c uuid) returns table(profile text, one_company boolean, profiles text[])
 language sql stable security definer set search_path='' as $function$
 select p.profile,public.install_has_one_company(),
  array_prepend(p.profile,array(select a.profile from public.agent_profiles a where a.company_id=c order by a.profile))
 from public.company_profiles p where p.company_id=c and public.is_member(c);
$function$;
revoke all on function public.company_engine_target(uuid) from public,anon,service_role;
grant execute on function public.company_engine_target(uuid) to authenticated;

create or replace function public.company_key_profiles(c uuid) returns table(profile text, kind text, agent uuid, name text)
 language sql stable security definer set search_path='' as $function$
 select x.profile,x.kind,x.agent,x.name from (
  select s.profile,'space' as kind,null::uuid as agent,null::text as name,0 as rank from public.company_shared_spaces s where s.company_id=c
  union all
  select p.profile,'company',k.id,k.name,1 from public.company_profiles p
   left join public.hermes_agents k on k.company_id=c and k.id=public.company_profile_keeper(c) where p.company_id=c
  union all
  select a.profile,'agent',a.agent_id,g.name,2 from public.agent_profiles a
   left join public.hermes_agents g on g.company_id=c and g.id=a.agent_id where a.company_id=c
  union all
  select l.profile,'removed',l.agent_id,l.agent_name,3 from public.agent_profile_leftovers l
   where l.company_id=c and not exists(select 1 from public.agent_profiles a where a.profile=l.profile)
 ) x
 where public.is_member(c) and exists(select 1 from public.company_profiles p where p.company_id=c)
 order by x.rank,x.profile;
$function$;

create or replace function public.company_profile_keeper(c uuid) returns uuid language sql stable security definer set search_path='' as $function$
 select coalesce((select k.agent_id from public.company_profile_keepers k where k.company_id=c),
  (select a.id from public.hermes_agents a where a.company_id=c and a.profile=public.company_engine_profile(c)
   order by a.is_default desc,a.created_at nulls first,a.id limit 1));
$function$;

create or replace function public.company_profile_work()
 returns table(company_id uuid, profile text, agent_level smallint, tools_level smallint, tools_policy integer, tools_pending boolean, attach boolean, move boolean)
 language sql stable security definer set search_path='' as $function$
 select w.id,public.company_engine_profile(w.id),w.agent_level,w.tools_level,w.tools_policy,coalesce(w.tools_pending,false),w.attach,w.move from (
  select c.id,c.agent_level,p.tools_level,p.tools_policy,p.tools_pending,p.company_id is not null as recorded,
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

-- Every Company and Agent profile an Agent runs on is read now and then; one the Engine lost is forgotten, so its
-- profile loop makes it again.
drop function public.engine_tools_due();
create function public.engine_tools_due() returns table(profile text) language sql stable security definer set search_path='' as $function$
 select distinct a.profile from public.hermes_agents a where a.profile ~ '^(co|ag)-[0-9a-f]{32}$' order by 1 limit 500;
$function$;
revoke all on function public.engine_tools_due() from public,anon,authenticated;
grant execute on function public.engine_tools_due() to service_role;

drop function public.forget_company_profile(uuid);
create function public.forget_company_profile(engine_profile text) returns boolean language plpgsql security definer set search_path='' as $function$
declare forgot boolean;
begin
 delete from public.company_profiles p where p.profile=engine_profile;
 forgot:=found;
 update public.agent_profiles p set tools_level=null,tools_policy=null,tools_pending=false,skills_shared=false
  where p.profile=engine_profile and p.tools_level is not null;
 return forgot or found;
end $function$;
revoke all on function public.forget_company_profile(text) from public,anon,authenticated;
grant execute on function public.forget_company_profile(text) to service_role;

create or replace function public.is_company_lead(c uuid, agent uuid) returns boolean language sql stable security definer set search_path='' as $function$
 select exists(select 1 from public.hermes_agents a
  where a.id=agent and a.company_id=c and a.is_default
   and (a.profile=public.company_engine_profile(c) or exists(select 1 from public.agent_profiles p where p.profile=a.profile and p.agent_id=a.id and p.company_id=c)));
$function$;

create or replace function public.lead_create_agent(conversation uuid, run text, call text, agent_name text, job text, apps text[], template text DEFAULT NULL::text, instructions text DEFAULT NULL::text, own_level integer DEFAULT NULL::integer, own_policy integer DEFAULT NULL::integer, own_answers boolean DEFAULT true)
 returns jsonb language plpgsql security definer set search_path='' as $function$
declare talk public.conversations; source text; made uuid; held boolean; own boolean;
 agent uuid:=public.lead_agent_id(conversation,run,call);
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select l.agent_id into made from public.lead_made_agents l where l.conversation_id=conversation and l.run_id=run and l.call_id=call;
 if found then
  -- A closer that raced the one that made the Agent wrote its tools to the same profile, perhaps after the worker had
  -- recorded a later level: unless they are the recorded ones, the worker writes and reads them back again first.
  if own_level is not null then
   update public.agent_profiles p set tools_pending=true where p.agent_id=made and (p.tools_level is distinct from own_level or p.tools_policy is distinct from own_policy);
  end if;
  return jsonb_build_object('state','created','agent',made);
 end if;
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not (public.may_use_lead_tools(talk.company_id,talk.agent_id,talk.person_id)
   or exists(select 1 from public.lead_agent_requests r where r.conversation_id=conversation and r.run_id=run and r.call_id=call and r.state='made'
    and public.may_use_lead_tools(talk.company_id,talk.agent_id,r.answered_by))) then return jsonb_build_object('state','refused'); end if;
 if not public.agent_fields_valid(agent_name,job,apps,template,instructions) or (own_level is null)<>(own_policy is null) or own_level not between 1 and 3
  or own_answers is null then
  return jsonb_build_object('state','invalid'); end if;
 held:=public.company_holds_provider_key(talk.company_id);
 if not held and not own_answers then own_level:=null; own_policy:=null; end if;
 own:=own_level is not null or held;
 select a.profile into source from public.hermes_agents a where a.id=talk.agent_id;
 -- The owner record comes first: the Agent on its profile is checked against it. Its tool state is what was read back,
 -- not today's level: a change meanwhile is work for the worker and holds its Runs.
 if own then
  insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) values(agent,talk.company_id,own_level,own_policy);
 end if;
 insert into public.hermes_agents(id,company_id,profile,name,speciality,requested_by,apps,template,instructions)
  values(agent,talk.company_id,
   case when own then public.agent_engine_profile(agent) when source ~ '^ag-[0-9a-f]{32}$' then public.company_engine_profile(talk.company_id) else source end,
   trim(agent_name),trim(job),talk.person_id,array(select trim(app) from unnest(apps) app),template,
   replace(instructions,'{company}',(select c.name from public.companies c where c.id=talk.company_id))) returning id into made;
 insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id) values(conversation,run,call,talk.company_id,made);
 if held and (own_level is null or not own_answers) then insert into public.agent_key_waits(agent_id,company_id) values(made,talk.company_id); end if;
 perform public.log_agent_event(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),made,'REQUEST_HERMES_AGENT',
  jsonb_strip_nulls(jsonb_build_object('agent_name',trim(agent_name),'job',trim(job),'conversation_id',conversation,'template',template)));
 return jsonb_build_object('state','created','agent',made);
end $function$;

-- An Owner makes an Agent the main one or removes it; no Agent is attached by hand any more.
drop function public.manage_hermes_agent(uuid,text,uuid,uuid,text,text,boolean,boolean,uuid);
create function public.manage_hermes_agent(c uuid, intent text, a uuid, replacement uuid default null) returns void
 language plpgsql security definer set search_path='' as $function$
declare current_agent public.hermes_agents; actor text; applied_replacement uuid;
begin
 if auth.uid() is null or not public.is_company_owner(c) then raise exception 'hermesNotAllowed' using errcode='42501'; end if;
 -- This install has few assignment writes; one lock serializes profile sharing and company defaults together.
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if not exists(select 1 from public.companies where id=c) then raise exception 'hermesAgentNotFound' using errcode='P0002'; end if;
 select * into current_agent from public.hermes_agents where id=a and company_id=c;
 if current_agent.id is null then raise exception 'hermesAgentNotFound' using errcode='P0002'; end if;
 if intent='default' then
  update public.hermes_agents set is_default=false where company_id=c and is_default;
  update public.hermes_agents set is_default=true where id=a;
 elsif intent='remove' then
  if current_agent.is_default and exists(select 1 from public.hermes_agents where company_id=c and id<>a) then
   if replacement is null or not exists(select 1 from public.hermes_agents where company_id=c and id=replacement and id<>a) then raise exception 'hermesNextDefault'; end if;
   update public.hermes_agents set is_default=false where id=a;
   update public.hermes_agents set is_default=true where id=replacement;
   applied_replacement:=replacement;
  end if;
  delete from public.hermes_agents where id=a;
 else raise exception 'hermesAgentFailed'; end if;
 select name into actor from public.people where id=auth.uid();
 perform public.log_agent_event(c,auth.uid(),actor,a,upper(intent)||'_HERMES_AGENT',jsonb_build_object('replacement_id',applied_replacement));
end;
$function$;
revoke all on function public.manage_hermes_agent(uuid,text,uuid,uuid) from public,anon,service_role;
grant execute on function public.manage_hermes_agent(uuid,text,uuid,uuid) to authenticated;

create or replace function public.pin_run_history(conversation uuid, message_key uuid) returns jsonb language plpgsql security definer set search_path='' as $function$
declare held public.conversation_run_reservations; kept public.conversation_run_notes; moved_at timestamptz; record jsonb;
begin
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key for update;
 select * into kept from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if kept.conversation_id is null then return null; end if;
 if kept.history is null and held.conversation_id is not null and held.start_attempts=0 and held.start_unknown_at is null
  and held.profile=public.agent_engine_profile(held.agent_id) then
  select max(l.created_at) into moved_at from public.company_log l where l.agent_id=held.agent_id and l.company_id=held.company_id
   and l.source='hermes_agent_audit' and l.action=public.log_agent_action('MOVE_AGENT_PROFILE');
  if moved_at is not null and exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.created_at<moved_at) then
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
end $function$;

-- reserve_conversation_turn answers the profile it pinned with the token.
do $$
declare def text;
begin
 def:=pg_get_functiondef('public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text)'::regprocedure);
 if position($r$'connection',pinned,$r$ in def)=0 then raise exception 'reserve_conversation_turn changed: %',def; end if;
 execute replace(def,$r$'connection',pinned,$r$,$r$'connection',pinned,'profile',(select r.profile from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key),$r$);
end $$;

-- The rule, request and answer functions wrote their log line through the audit table: from their current bodies,
-- the same line goes to the company log.
do $$
declare f regprocedure; def text;
begin
 for f in select p.oid::regprocedure from pg_proc p where p.pronamespace='public'::regnamespace and p.prosrc like '%insert into public.hermes_agent_audit%' loop
  def:=regexp_replace(pg_get_functiondef(f),'insert into public\.hermes_agent_audit\(company_id,actor_id,actor_name,agent_id,action,details\)\s*values\(','perform public.log_agent_event(','g');
  if def like '%hermes_agent_audit(%' then raise exception '% still writes the audit table',f; end if;
  execute def;
 end loop;
end $$;

drop function public.is_bundled_connection(uuid);
drop function public.bundled_hermes_waiting();
drop function public.provide_bundled_hermes(text,text,text,text,text[]);
drop table public.hermes_agent_audit;
drop function public.log_agent_change();
drop table public.hermes_connections cascade;
drop function public.guard_attached_hermes_profile();
drop function public.keep_reserved_connection();
drop function public.keep_hermes_destination();
drop function public.guard_agent_profile_connection();
drop function public.guard_company_profile_connection();
drop function public.guard_shared_space_connection();
