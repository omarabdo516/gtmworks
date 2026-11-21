-- #391, ADR 0018, ADR 0023: the second step of removing Agent levels, the cutover. scripts/install.sh applies a
-- migration whose name ends in _cutover only once this release's app and worker answer, so the release it replaced has
-- stopped serving and a failed update has already left it running on the first step's schema
-- (20270408100000_one_set_of_tools.sql), which it was built for.
--
-- The Company's level and its column, the function that changed it, the level table's policy version and the
-- database's copy of it (engine_tool_policy) go, with the previous release's record functions and its call that makes an
-- Agent for Lead. Every function that read the level reads the confirmation instead.
--
-- Kept on purpose: the Company's log rows of past level changes, and the audit shape that names them, so history still
-- reads. Nothing else stored is dropped, and no grant changes: every function keeps the role that held it.

-- 1. The functions that read the level, the policy or either profile's tool state, and the previous release's own
-- writers. Dropped before the columns so their dependencies go with them; each reader is made again below.
drop function if exists public.set_agent_level(uuid,integer);
drop function if exists public.engine_tool_policy();
drop function if exists public.company_profile_ready(uuid);
drop function if exists public.agent_profile_refusal(text,uuid,uuid);
drop function if exists public.reserve_conversation_run(uuid,uuid,uuid,uuid,text);
drop function if exists public.claim_conversation_turn(uuid);
drop function if exists public.company_profile_work();
drop function if exists public.agent_profile_work();
drop function if exists public.record_company_profile(uuid,text,integer,integer);
-- 20270407042500 (#425) gave it the main Agent's sub-agents switch.
drop function if exists public.record_company_profile(uuid,text,integer,integer,boolean);
drop function if exists public.record_agent_profile(uuid,text,integer,integer,boolean);
drop function if exists public.move_agent_profile(uuid);
drop function if exists public.agent_move_work();
drop function if exists public.agent_soul_rules_work();
drop function if exists public.shared_skills_work();
drop function if exists public.forget_company_profile(text);
drop function if exists public.lead_agent_profile(uuid,text,text,text);
drop function if exists public.lead_create_agent(uuid,text,text,text,text,text[],text,text,integer,integer,boolean,boolean);

-- 2. The level column and the profiles' level and policy columns. A profile the previous release's worker confirmed, and
-- this release's has not yet, keeps its record but is marked as changing, so the worker writes the fixed set and records
-- the read-back before any Run starts on it; one this release's worker already confirmed is left as it is.
alter table public.companies drop column agent_level;

update public.company_profiles set tools_confirmed=true,tools_pending=true where tools_level is not null and not tools_confirmed;
alter table public.company_profiles drop column tools_level;
alter table public.company_profiles drop column tools_policy;

update public.agent_profiles set tools_confirmed=true,tools_pending=true where tools_level is not null and not tools_confirmed;
alter table public.agent_profiles drop constraint agent_profiles_tools_whole;
alter table public.agent_profiles drop column tools_level;
alter table public.agent_profiles drop column tools_policy;

-- 3. A Company runs on its profile once the worker confirmed exactly the fixed set and the shared folder. 20270102's,
-- unchanged but for the confirmation.
create function public.company_profile_ready(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.company_profiles p
  where p.company_id=c and p.tools_confirmed and not p.tools_pending and (p.skills_shared or not public.shared_skills_active(c)));
$$;

-- Every Run entry asks this: a shared space never runs, and an Agent's own profile runs only once it also reads the
-- Company's shared folder, confirmed. 20270121's, unchanged but for the confirmation and its name.
create function public.agent_profile_refusal(engine_profile text, c uuid, agent uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
  when coalesce(engine_profile,'') ~ '^cs-[0-9a-f]{32}$' then 'hermesProfileNotShared'
  when coalesce(engine_profile,'') !~ '^ag-[0-9a-f]{32}$' then null
  when not exists(select 1 from public.agent_profiles p where p.profile=engine_profile and p.agent_id=agent and p.company_id=c) then 'hermesProfileNotShared'
  when exists(select 1 from public.agent_key_waits w where w.agent_id=agent and w.company_id=c) and public.company_holds_provider_key(c) then 'agentToolsPending'
  when not exists(select 1 from public.agent_profiles p
   where p.agent_id=agent and p.company_id=c and p.tools_confirmed and not p.tools_pending and (p.skills_shared or not public.shared_skills_active(c))) then 'agentToolsPending'
 end;
$$;

-- 20270213's reservation, unchanged but for the confirmation's name.
create function public.reserve_conversation_run(conversation uuid, c uuid, agent uuid, message_key uuid, message text)
 returns uuid language plpgsql security definer set search_path='' as $function$
declare existing public.conversations; held public.conversation_run_reservations; target text; token uuid; refusal text;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if message is null or length(message) not between 0 and 200000 then raise exception 'conversationNotFound' using errcode='22023'; end if;
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
  if not public.company_profile_ready(c) then raise exception 'agentToolsPending' using errcode='55000'; end if;
 end if;
 refusal:=public.agent_profile_refusal(target,c,agent);
 if refusal='hermesProfileNotShared' then raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 if refusal='agentToolsPending' then raise exception 'agentToolsPending' using errcode='55000'; end if;
 insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
  values(conversation,message_key,c,token,auth.uid(),agent,message,target)
  on conflict (conversation_id,send_key) do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null,
   start_attempts=0,start_unknown_at=null
   where public.conversation_run_reservations.abandoned_at is not null;
 return token;
end $function$;
revoke all on function public.reserve_conversation_run(uuid,uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.reserve_conversation_run(uuid,uuid,uuid,uuid,text) to authenticated;

-- 20270220's claim, unchanged but for the confirmation's name.
create function public.claim_conversation_turn(conversation uuid)
 returns table(company uuid, agent uuid, person uuid, send_key uuid, message text, connection uuid, profile text, note text, retry boolean, has_files boolean)
 language plpgsql security definer set search_path='' as $function$
declare turn public.conversation_queued_turns; held public.conversation_run_reservations; uncertain boolean; refusal text; target text; token uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if exists(select 1 from public.conversation_open_run(conversation)) then return; end if;
 select q.* into turn from public.conversation_queued_turns q where q.conversation_id=conversation and q.started_at is null and q.failed_at is null
  order by exists(select 1 from public.conversation_run_reservations r where r.conversation_id=q.conversation_id and r.send_key=q.send_key and r.abandoned_at is null) desc,q.queued_at,q.send_key limit 1;
 if not found then return; end if;
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
 if (target is null or (target ~ '^co-[0-9a-f]{32}$' and target<>public.company_engine_profile(turn.company_id)) or refusal='hermesProfileNotShared') and not uncertain then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 if target is null then return; end if;
 -- A retry whose first start's answer was lost still waits for the fixed set: the Run is never sent to a profile whose
 -- tools are being changed or were never confirmed.
 if (target ~ '^co-[0-9a-f]{32}$' and not public.company_profile_ready(turn.company_id)) or refusal='agentToolsPending' then return; end if;
 if held.conversation_id is null then
  insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
   values(conversation,turn.send_key,turn.company_id,token,turn.person_id,turn.agent_id,turn.message,target)
   on conflict on constraint conversation_run_reservations_pkey do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null,
    start_attempts=0,start_unknown_at=null
    where public.conversation_run_reservations.abandoned_at is not null;
 end if;
 return query select turn.company_id,turn.agent_id,turn.person_id,turn.send_key,turn.message,token,target,
  public.pinned_run_note(conversation,turn.send_key,turn.company_id,turn.person_id),uncertain,
  exists(select 1 from public.conversation_attachments a where a.conversation_id=conversation and a.company_id=turn.company_id and a.send_key=turn.send_key);
end $function$;
revoke all on function public.claim_conversation_turn(uuid) from public,anon,authenticated;
grant execute on function public.claim_conversation_turn(uuid) to service_role;

-- 20270407042500's Company work (#425: it carries the main Agent's sub-agents switch), unchanged but for the
-- confirmation: a recorded profile is work while it is unconfirmed or marked as changing, and a profile whose Engine lost
-- it is made again.
create function public.company_profile_work()
 returns table(company_id uuid, profile text, tools_confirmed boolean, tools_pending boolean, attach boolean, move boolean, subagents boolean)
 language sql stable security definer set search_path='' as $function$
 select w.id,public.company_engine_profile(w.id),w.tools_confirmed,coalesce(w.tools_pending,false),w.attach,w.move,coalesce(w.subagents,false) from (
  select c.id,coalesce(p.tools_confirmed,false) as tools_confirmed,p.tools_pending,p.subagents,p.company_id is not null as recorded,
   p.company_id is null and exists(select 1 from public.hermes_agents a where a.company_id=c.id and a.profile=public.company_engine_profile(c.id)) as lost,
   not exists(select 1 from public.hermes_agents a where a.company_id=c.id) as attach,
   exists(select 1 from public.hermes_agents a where a.company_id=c.id and a.profile<>public.company_engine_profile(c.id) and a.profile !~ '^ag-[0-9a-f]{32}$') as move
  from public.companies c left join public.company_profiles p on p.company_id=c.id
  where exists(select 1 from public.members m where m.company_id=c.id and m.role='owner' and m.removed_at is null)) w
 where w.attach or w.move or w.lost
  or (w.recorded and (not w.tools_confirmed or w.tools_pending))
 order by (w.move and not w.attach and not w.lost and not (w.recorded and (not w.tools_confirmed or w.tools_pending))),
  case when w.move and not w.attach and not w.lost then md5(w.id::text||date_trunc('minute',now())::text) end,w.id
 limit 100;
$function$;
revoke all on function public.company_profile_work() from public,anon,authenticated;
grant execute on function public.company_profile_work() to service_role;

-- 20270402's Agent work, unchanged but for the confirmation.
create function public.agent_profile_work()
 returns table(agent_id uuid, company_id uuid, profile text, tools_confirmed boolean, tools_pending boolean, instructions text, subagents boolean)
 language sql stable security definer set search_path='' as $$
 select p.agent_id,p.company_id,p.profile,p.tools_confirmed,p.tools_pending,a.instructions,p.subagents
 from public.agent_profiles p join public.hermes_agents a on a.id=p.agent_id and a.company_id=p.company_id
 where not p.tools_confirmed or p.tools_pending
 order by p.tools_confirmed,md5(p.agent_id::text||date_trunc('minute',now())::text)
 limit 100;
$$;
revoke all on function public.agent_profile_work() from public,anon,authenticated;
grant execute on function public.agent_profile_work() to service_role;

-- An Agent moves only to a profile whose fixed tools and shared folder are confirmed.
create function public.move_agent_profile(agent uuid) returns boolean language plpgsql security definer set search_path='' as $function$
declare moving public.hermes_agents; first_owner uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into moving from public.hermes_agents where id=agent;
 if not found or not public.company_profile_ready(moving.company_id) or not public.agent_may_move(agent) or public.agent_move_blocked(agent)
  or not exists(select 1 from public.agent_profiles p where p.agent_id=agent and p.company_id=moving.company_id
   and p.tools_confirmed and not p.tools_pending and (p.skills_shared or not public.shared_skills_active(moving.company_id))) then return false; end if;
 select m.person_id into first_owner from public.members m where m.company_id=moving.company_id and m.role='owner' and m.removed_at is null order by m.person_id limit 1;
 update public.hermes_agents set profile=public.agent_engine_profile(agent),connection_id=gen_random_uuid() where id=agent;
 perform public.log_agent_event(moving.company_id,first_owner,null,agent,'MOVE_AGENT_PROFILE','{}');
 return true;
end $function$;
revoke all on function public.move_agent_profile(uuid) from public,anon,authenticated;
grant execute on function public.move_agent_profile(uuid) to service_role;

-- 20261228's move list, unchanged but for the fixed tools and the sub-agents choice the record call needs.
create function public.agent_move_work() returns table(agent_id uuid, company_id uuid, profile text, instructions text, subagents boolean, recorded boolean)
language sql stable security definer set search_path='' as $$
 select a.id,a.company_id,public.agent_engine_profile(a.id),a.instructions,
  coalesce((select p.subagents from public.agent_profiles p where p.agent_id=a.id),false),
  exists(select 1 from public.agent_profiles p where p.agent_id=a.id)
 from public.hermes_agents a
 where public.company_profile_ready(a.company_id) and public.agent_may_move(a.id) and not public.agent_move_blocked(a.id)
 order by md5(a.id::text||date_trunc('minute',now())::text)
 limit 100;
$$;
revoke all on function public.agent_move_work() from public,anon,authenticated;
grant execute on function public.agent_move_work() to service_role;

-- A profile the Engine lost is made again with no confirmed tools, so its Runs wait until the worker read the fixed set
-- back. 20270213's field list, unchanged but for the confirmation.
create function public.forget_company_profile(engine_profile text) returns boolean language plpgsql security definer set search_path='' as $function$
declare forgot boolean;
begin
 delete from public.company_profiles p where p.profile=engine_profile;
 forgot:=found;
 update public.agent_profiles p set tools_confirmed=false,tools_pending=false,skills_shared=false where p.profile=engine_profile;
 return forgot or found;
end $function$;
revoke all on function public.forget_company_profile(text) from public,anon,authenticated;
grant execute on function public.forget_company_profile(text) to service_role;

-- 20270402's rules list, unchanged but for the confirmation.
create function public.agent_soul_rules_work() returns table(company_id uuid, profile text, rules jsonb)
language sql stable security definer set search_path='' as $$
 select x.company_id,x.profile,coalesce((select jsonb_agg(r.body order by r.said_at,r.id) from public.agent_rules r
   where r.agent_id=x.id and r.removed_at is null and (r.suggestion is null or r.suggestion='approved')),'[]')
 from (select a.id,a.company_id,coalesce((select p.profile from public.agent_profiles p where p.agent_id=a.id and (p.tools_confirmed or p.tools_pending)),
   case when a.is_default then (select c.profile from public.company_profiles c where c.company_id=a.company_id) end) as profile
  from public.hermes_agents a) x
 where x.profile is not null
 order by md5(x.id::text||date_trunc('minute',now())::text)
 limit 100;
$$;
revoke all on function public.agent_soul_rules_work() from public,anon,authenticated;
grant execute on function public.agent_soul_rules_work() to service_role;

-- 20270102's shared Skills list, unchanged but for the confirmation.
create function public.shared_skills_work() returns table(company_id uuid, profile text, folder text, lessons jsonb, profiles jsonb)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
begin
 return query with listed as (select c.id from public.companies c
  where exists(select 1 from public.company_profiles p where p.company_id=c.id)
   or exists(select 1 from public.agent_profiles p where p.company_id=c.id and (p.tools_confirmed or p.tools_pending))
  order by md5(c.id::text||date_trunc('minute',now())::text) limit 100),
 seen as (update public.company_shared_spaces s set seen_at=now() from listed l where s.company_id=l.id)
 select c.id,public.shared_space_profile(c.id),s.folder,
  coalesce((select jsonb_agg(r.body order by r.said_at,r.id) from public.agent_rules r where r.company_id=c.id and r.suggestion='approved' and r.removed_at is null),'[]'),
  coalesce((select jsonb_agg(jsonb_build_object('profile',x.profile) order by x.profile) from (
   select p.profile from public.company_profiles p where p.company_id=c.id and not p.skills_shared
   union all
   select p.profile from public.agent_profiles p where p.company_id=c.id and (p.tools_confirmed or p.tools_pending) and not p.skills_shared) x),'[]')
 from listed l join public.companies c on c.id=l.id left join public.company_shared_spaces s on s.company_id=c.id
 order by md5(c.id::text||date_trunc('minute',now())::text);
end $$;
revoke all on function public.shared_skills_work() from public,anon,authenticated;
grant execute on function public.shared_skills_work() to service_role;

-- 20270102's shared-folder record, unchanged but for a profile that is made and waiting for its tools.
drop function public.record_shared_skills(uuid,text);
create function public.record_shared_skills(c uuid, engine_profile text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.company_shared_spaces s where s.company_id=c for share;
 if not found then return false; end if;
 update public.company_profiles p set skills_shared=true where p.company_id=c and p.profile=engine_profile;
 if found then return true; end if;
 update public.agent_profiles p set skills_shared=true where p.company_id=c and p.profile=engine_profile and (p.tools_confirmed or p.tools_pending);
 return found;
end $$;
revoke all on function public.record_shared_skills(uuid,text) from public,anon,authenticated;
grant execute on function public.record_shared_skills(uuid,text) to service_role;

-- What Lead's call would make: the profile name and the soul fitted to the Company, with no level.
create function public.lead_agent_profile(conversation uuid, run text, call text, instructions text default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(
  (select jsonb_build_object('state','created','agent',l.agent_id) from public.lead_made_agents l
   where l.conversation_id=conversation and l.run_id=run and l.call_id=call),
  (select jsonb_build_object('profile',public.agent_engine_profile(public.lead_agent_id(conversation,run,call)),
    'soul',replace(instructions,'{company}',co.name))
   from public.conversations v join public.companies co on co.id=v.company_id
   where v.id=conversation and public.may_use_lead_tools(v.company_id,v.agent_id,v.person_id)));
$$;
revoke all on function public.lead_agent_profile(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.lead_agent_profile(uuid,text,text,text) to service_role;

-- The one function that makes an Agent for Lead's call, with `own_profile` in place of the level and policy: it is true
-- only when the Engine provided the profile with the fixed set and the read-back matched it, so the record comes back
-- confirmed.
create function public.lead_create_agent(conversation uuid, run text, call text, agent_name text, job text, apps text[], template text default null, instructions text default null,
 own_profile boolean default false, own_answers boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare talk public.conversations; source text; made uuid; held boolean;
 agent uuid:=public.lead_agent_id(conversation,run,call);
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select l.agent_id into made from public.lead_made_agents l where l.conversation_id=conversation and l.run_id=run and l.call_id=call;
 if found then
  -- A closer that raced the one that made the Agent wrote the same fixed set to the same profile and the Engine read it
  -- back (own_profile), so the record it left stays confirmed. One that did not provide it changes nothing: the worker
  -- makes the profile and records it.
  if own_profile then update public.agent_profiles p set tools_confirmed=true,tools_pending=false where p.agent_id=made; end if;
  return jsonb_build_object('state','created','agent',made);
 end if;
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not (public.may_use_lead_tools(talk.company_id,talk.agent_id,talk.person_id)
   or exists(select 1 from public.lead_agent_requests r where r.conversation_id=conversation and r.run_id=run and r.call_id=call and r.state='made'
    and public.may_use_lead_tools(talk.company_id,talk.agent_id,r.answered_by))) then return jsonb_build_object('state','refused'); end if;
 if not public.agent_fields_valid(agent_name,job,apps,template,instructions) or own_profile is null or own_answers is null then
  return jsonb_build_object('state','invalid'); end if;
 held:=public.company_holds_provider_key(talk.company_id);
 if not held and not own_answers then own_profile:=false; end if;
 select a.profile into source from public.hermes_agents a where a.id=talk.agent_id;
 -- The owner record comes first: the Agent on its profile is checked against it. `own_profile` says the Engine provided
 -- the profile with the fixed set and the read-back matched, so its tools are confirmed; an Agent the Company's held key
 -- put on its own profile without that waits for the worker, which provides it. A Company holding a provider key gives
 -- every Agent its own profile, as before.
 if own_profile or held then
  insert into public.agent_profiles(agent_id,company_id,tools_confirmed,tools_pending) values(agent,talk.company_id,own_profile,not own_profile);
 end if;
 insert into public.hermes_agents(id,company_id,profile,name,speciality,requested_by,apps,template,instructions)
  values(agent,talk.company_id,
   case when own_profile or held then public.agent_engine_profile(agent) when source ~ '^ag-[0-9a-f]{32}$' then public.company_engine_profile(talk.company_id) else source end,
   trim(agent_name),trim(job),talk.person_id,array(select trim(app) from unnest(apps) app),template,
   replace(instructions,'{company}',(select c.name from public.companies c where c.id=talk.company_id))) returning id into made;
 insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id) values(conversation,run,call,talk.company_id,made);
 if held and (not own_profile or not own_answers) then insert into public.agent_key_waits(agent_id,company_id) values(made,talk.company_id); end if;
 perform public.log_agent_event(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),made,'REQUEST_HERMES_AGENT',
  jsonb_strip_nulls(jsonb_build_object('agent_name',trim(agent_name),'job',trim(job),'conversation_id',conversation,'template',template)));
 return jsonb_build_object('state','created','agent',made);
end $function$;
revoke all on function public.lead_create_agent(uuid,text,text,text,text,text[],text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.lead_create_agent(uuid,text,text,text,text,text[],text,text,boolean,boolean) to service_role;
