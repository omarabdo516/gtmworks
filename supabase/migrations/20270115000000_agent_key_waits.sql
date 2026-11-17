-- #299: once a Company holds a provider key, an Agent Lead makes later never runs on Lead's profile. The Engine makes
-- its own profile with no key and no model (a clone would copy the shared space's Skills, #124), so lead_create_agent
-- attaches the Agent there and holds it (agent_key_waits): every Run entry refuses it as agentLevelPending, and the
-- Owner sees it in "Waiting on you" until a key set gives its profile key and model (end_agent_key_waits). A removed
-- Agent's profile stays in the Engine, so its name is kept (agent_profile_leftovers) and company_key_profiles lists it
-- for the next key removal.
--
-- Nothing existing is rewritten: both tables start empty, the trigger writes only on a later removal, and with no wait
-- and no leftover every replaced function answers as before. The previous app version runs against this: its create
-- calls name at most ten arguments, which reach the new function with own_answers true, the path they took before; its
-- key routes read only the 'company' and 'agent' kinds and never call end_agent_key_waits. A wait exists only once this
-- version made one, so after a rollback the previous app lists it as an item it cannot open, and the Agent stays held
-- until this version's next set.

-- An Agent attached to its own profile after the Company's key was set, until a set gives that profile key and model.
create table public.agent_key_waits (
 id bigint generated always as identity primary key,
 agent_id uuid not null unique,
 company_id uuid not null,
 created_at timestamptz not null default now(),
 constraint agent_key_waits_agent foreign key (company_id,agent_id) references public.hermes_agents(company_id,id) on delete cascade
);
alter table public.agent_key_waits enable row level security;
revoke all on public.agent_key_waits from anon,authenticated,service_role;
-- Read by waiting_list as the signed-in person, as lead_agent_requests is: the Owner's only.
create policy agent_key_waits_read on public.agent_key_waits for select to authenticated using (public.is_company_owner(company_id));
grant select on public.agent_key_waits to authenticated;

-- A removed Agent's Engine profile, by name only: no key, no profile content. Never deleted here.
create table public.agent_profile_leftovers (
 profile text primary key check (profile ~ '^ag-[0-9a-f]{32}$'),
 company_id uuid not null references public.companies(id) on delete cascade,
 agent_id uuid not null,
 agent_name text,
 removed_at timestamptz not null default now()
);
alter table public.agent_profile_leftovers enable row level security;
revoke all on public.agent_profile_leftovers from anon,authenticated,service_role;

-- The Engine says whether a profile holds a key only when asked over the network, so the create path reads the
-- Company's log instead: some provider's last set or removal is a set.
create function public.company_holds_provider_key(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(bool_or(l.action='provider_key_set'),false) from (
  select distinct on (a.provider) a.action from public.company_audit a
   where a.company_id=c and a.action in ('provider_key_set','provider_key_removed') order by a.provider,a.created_at desc,a.id desc) l;
$$;
revoke all on function public.company_holds_provider_key(uuid) from public,anon,authenticated,service_role;

-- 20261226000000's, replaced with one more argument: own_answers false when the Engine made the profile with the
-- level's tools but it has no model to answer with. A Company that holds a key gets the Agent there, held until the
-- Owner's next set; one that holds none gets it on Lead's profile, as before.
drop function public.lead_create_agent(uuid,text,text,text,text,text[],text,text,integer,integer);
create function public.lead_create_agent(conversation uuid, run text, call text, agent_name text, job text, apps text[], template text default null, instructions text default null,
 own_level integer default null, own_policy integer default null, own_answers boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; linked public.hermes_connections; connection uuid; made uuid; waits boolean:=false;
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
 if not public.agent_fields_valid(agent_name,job,apps,template,instructions) or (own_level is null)<>(own_policy is null) or own_level not between 1 and 3 then
  return jsonb_build_object('state','invalid'); end if;
 if own_level is not null and not own_answers then
  if public.company_holds_provider_key(talk.company_id) then waits:=true; else own_level:=null; own_policy:=null; end if;
 end if;
 select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=talk.agent_id;
 -- The owner record comes first: the Connection naming the profile and the Agent on it are checked against it. Its tool
 -- state is what was read back, not today's level: a change meanwhile is work for the worker and holds its Runs.
 if own_level is not null then
  insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) values(agent,talk.company_id,own_level,own_policy);
 end if;
 insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state,version,features)
  values(talk.company_id,talk.person_id,linked.address,
   case when own_level is not null then public.agent_engine_profile(agent) when linked.profile ~ '^ag-[0-9a-f]{32}$' then public.company_engine_profile(talk.company_id) else linked.profile end,
   linked.key_encrypted,linked.state,linked.version,linked.features) returning id into connection;
 insert into public.hermes_agents(id,company_id,connection_id,name,speciality,requested_by,apps,template,instructions)
  values(agent,talk.company_id,connection,trim(agent_name),trim(job),talk.person_id,array(select trim(app) from unnest(apps) app),template,
   replace(instructions,'{company}',(select c.name from public.companies c where c.id=talk.company_id))) returning id into made;
 insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id) values(conversation,run,call,talk.company_id,made);
 if waits then insert into public.agent_key_waits(agent_id,company_id) values(made,talk.company_id); end if;
 insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
  values(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),made,'REQUEST_HERMES_AGENT',
   jsonb_strip_nulls(jsonb_build_object('connection_id',connection,'agent_name',trim(agent_name),'job',trim(job),'conversation_id',conversation,'template',template)));
 return jsonb_build_object('state','created','agent',made);
end $$;
revoke all on function public.lead_create_agent(uuid,text,text,text,text,text[],text,text,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.lead_create_agent(uuid,text,text,text,text,text[],text,text,integer,integer,boolean) to service_role;

-- 20270102000000's, unchanged but for an Agent waiting for the key, which no Run entry starts.
create or replace function public.agent_profile_refusal(engine_profile text, c uuid, agent uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
  when coalesce(engine_profile,'') ~ '^cs-[0-9a-f]{32}$' then 'hermesProfileNotShared'
  when coalesce(engine_profile,'') !~ '^ag-[0-9a-f]{32}$' then null
  when not exists(select 1 from public.agent_profiles p where p.profile=engine_profile and p.agent_id=agent and p.company_id=c) then 'hermesProfileNotShared'
  when exists(select 1 from public.agent_key_waits w where w.agent_id=agent and w.company_id=c) then 'agentLevelPending'
  when not exists(select 1 from public.agent_profiles p join public.companies co on co.id=p.company_id
   where p.agent_id=agent and p.tools_level=co.agent_level and p.tools_policy=public.engine_tool_policy() and not p.tools_pending and (p.skills_shared or not public.shared_skills_active(c))) then 'agentLevelPending'
 end;
$$;

-- 20270112000000's list, and for an active Owner each Agent waiting for the key, by its name.
create or replace function public.waiting_list(c uuid)
returns table(kind text, id bigint, title text, body text, asked_by text, card_id bigint, conversation_id uuid, created_at timestamptz)
language sql stable set search_path='' as $$
 select * from (
  select 'approval'::text, w.id, w.title, coalesce(a.name,''), ''::text, w.id, null::uuid, coalesce(w.review_entered_at,w.created_at)
   from public.work_cards w
   join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id and s.kind='review'
   left join public.approval_steps a on a.company_id=w.company_id and a.id=w.approval_step_id
   where w.company_id=c and w.approval_step_id is not null and public.approval_holds(c,w.approval_step_id)
  union all
  select i.kind, i.id, i.title, i.body, i.asked_by, i.card_id, i.conversation_id, i.created_at
   from public.waiting_items i where i.company_id=c and i.person_id=auth.uid() and i.resolved_at is null
  union all
  select 'agent_request'::text, r.id, r.agent_name, r.job, coalesce(p.name,''), null::bigint, null::uuid, r.created_at
   from public.lead_agent_requests r
   join public.members m on m.company_id=r.company_id and m.person_id=r.asked_by and m.removed_at is null
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and r.state='waiting' and public.is_company_owner(c)
  union all
  select 'question'::text, q.id, q.content->>'question', ''::text, v.agent_name, null::bigint, q.conversation_id, q.created_at
   from public.reply_cards q
   join public.conversations v on v.id=q.conversation_id and v.company_id=q.company_id
   where q.company_id=c and q.kind='question' and q.state='open' and v.person_id=auth.uid()
    and not exists(select 1 from public.conversation_usage u where u.conversation_id=q.conversation_id and u.run_id=q.run_id)
  union all
  select 'agent_key'::text, k.id, g.name, ''::text, ''::text, null::bigint, null::uuid, k.created_at
   from public.agent_key_waits k
   join public.hermes_agents g on g.company_id=k.company_id and g.id=k.agent_id
   where k.company_id=c and public.is_company_owner(c)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;

-- The Owner's set gave these profiles key and model (lib/provider-keys.mjs): their Agents may start Runs there.
create function public.end_agent_key_waits(c uuid, reached text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'keyNotAllowed' using errcode='42501'; end if;
 delete from public.agent_key_waits w using public.agent_profiles p
  where w.company_id=c and p.agent_id=w.agent_id and p.company_id=c and p.profile=any(reached);
end $$;
revoke all on function public.end_agent_key_waits(uuid,text[]) from public,anon,service_role;
grant execute on function public.end_agent_key_waits(uuid,text[]) to authenticated;

-- Before the Agent goes, and agent_profiles with it, its profile's name is kept, whoever removes it.
create function public.keep_agent_profile_leftover() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.agent_profile_leftovers(profile,company_id,agent_id,agent_name)
  select p.profile,p.company_id,p.agent_id,old.name from public.agent_profiles p where p.agent_id=old.id and p.company_id=old.company_id
  on conflict (profile) do nothing;
 return old;
end $$;
revoke all on function public.keep_agent_profile_leftover() from public,anon,authenticated,service_role;
create trigger agent_profile_leftover before delete on public.hermes_agents for each row execute function public.keep_agent_profile_leftover();

-- 20270109000000's, and each removed Agent's profile, unless a live Agent names it again.
create or replace function public.company_key_profiles(c uuid) returns table(profile text, kind text, agent uuid, name text)
language sql stable security definer set search_path='' as $$
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
 where public.is_member(c) and exists(select 1 from public.company_profiles p join public.hermes_connections h on h.company_id=p.company_id
  where p.company_id=c and public.is_bundled_connection(h.id))
 order by x.rank,x.profile;
$$;
