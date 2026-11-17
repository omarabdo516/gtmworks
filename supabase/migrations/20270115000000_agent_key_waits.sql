-- #299: once a Company holds a provider key, an Agent Lead makes later never runs on Lead's profile. lead_create_agent
-- attaches it to its own profile, `ag-<agent>`: the one the Engine made for the call with no key and no model (a clone
-- would copy the shared space's Skills, #124), or, when the Engine could not provide one or none was asked for («Make
-- it»), an owner record with no tools, which the worker makes as it makes a lost one. Unless the Engine made it able to
-- answer, the Agent is held (agent_key_waits): every Run entry refuses it as agentLevelPending, and the Owner sees it in
-- "Waiting on you" until a key set gives its profile key and model. A removed Agent's profile stays in the Engine, so
-- its name is kept (agent_profile_leftovers) and company_key_profiles lists it for the next key removal, until a removal
-- leaves it holding no key.
--
-- Whether the Company holds a key is company_key_holds, written only by the server through the service role and under
-- the lock lead_create_agent takes: begin_provider_key_change before the Engine is asked anything, so an Agent made while
-- a change is under way waits, and finish_provider_key_change with the Engine's answer. finish is the only end of a wait,
-- so no Owner ends one from the browser.
--
-- Nothing existing is rewritten: the new tables start empty but company_key_holds, which is filled once from each
-- Company's last set or removal of each provider's key in its log; the trigger writes only on a later removal; and with
-- no key held, no wait and no leftover every replaced function answers as before. The previous app version runs against
-- this. Its create calls name at most ten arguments and reach the new function with own_answers true, the path they took
-- before, but while the Company holds a key a call with no own profile (its Engine failed or refused, or the profile had
-- no model, which that version does not pass on) makes the Agent on an owner record with no tools, waiting, instead of
-- on Lead's profile; its worker makes that profile as it makes a lost one, and its «Make it» does the same. Its key
-- routes never begin or finish a change, so a set or removal it makes leaves company_key_holds as it was, ends no wait
-- and forgets no leftover, and they read only the 'company' and 'agent' kinds. Its "Waiting on you" lists a wait as an
-- item it cannot open. So while it runs, during an update or after a rollback, such an Agent waits until this version's
-- next set, and the holds are right again from this version's next Owner read (settle_provider_key_holds).

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

-- A removed Agent's Engine profile, by name only: no key, no profile content. Forgotten once a removal leaves it holding
-- no key (forget_agent_profile_leftovers).
create table public.agent_profile_leftovers (
 profile text primary key check (profile ~ '^ag-[0-9a-f]{32}$'),
 company_id uuid not null references public.companies(id) on delete cascade,
 agent_id uuid not null,
 agent_name text,
 removed_at timestamptz not null default now()
);
alter table public.agent_profile_leftovers enable row level security;
revoke all on public.agent_profile_leftovers from anon,authenticated,service_role;

-- Whether the Company holds a provider's key, as the server last recorded the Engine's answer, and `changing` from the
-- start of a set or removal until that answer is recorded. The Engine says whether a profile holds a key only when asked
-- over the network, so the create path reads this instead. Provider names only, never a key.
create table public.company_key_holds (
 company_id uuid not null references public.companies(id) on delete cascade,
 provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
 held boolean not null,
 changing boolean not null default false,
 primary key (company_id,provider)
);
alter table public.company_key_holds enable row level security;
revoke all on public.company_key_holds from anon,authenticated,service_role;
-- Before this version, only the log knew: a provider's last set or removal there is whether the Company holds its key.
insert into public.company_key_holds(company_id,provider,held)
 select distinct on (a.company_id,a.provider) a.company_id,a.provider,a.action='provider_key_set' from public.company_audit a
  where a.action in ('provider_key_set','provider_key_removed') order by a.company_id,a.provider,a.created_at desc,a.id desc;

-- Some provider's key is held, or a change of one is under way: an Agent made now waits for the Owner's next set.
create function public.company_holds_provider_key(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.company_key_holds h where h.company_id=c and (h.held or h.changing));
$$;
revoke all on function public.company_holds_provider_key(uuid) from public,anon,authenticated,service_role;

-- The server is about to set or remove the provider's key (lib/provider-keys.mjs). Under lead_create_agent's lock, so a
-- create that found no key held has made its Agent, whose profile is among those the change then reads and writes, and
-- every later one waits.
create function public.begin_provider_key_change(c uuid, key_provider text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(key_provider,'') !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then raise exception 'keyInvalid' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 insert into public.company_key_holds(company_id,provider,held,changing) values(c,key_provider,false,true)
  on conflict (company_id,provider) do update set changing=true;
end $$;
revoke all on function public.begin_provider_key_change(uuid,text) from public,anon,authenticated;
grant execute on function public.begin_provider_key_change(uuid,text) to service_role;

-- How the Engine answered the change: now_held true for a set it took, false for a removal, null for any other answer
-- (the key is as it was). While the key is held, the waits of the Agents whose profile the set gave key and model
-- (reached) end, and the answer is the Company's Agent profiles still waiting, which an Agent made during the set waits
-- on: the server gives those the key and finishes again. A change the Engine did not answer is not finished, so it
-- stays changing until the next one.
create function public.finish_provider_key_change(c uuid, key_provider text, now_held boolean, reached text[]) returns text[]
language plpgsql security definer set search_path='' as $$
declare kept boolean;
begin
 if coalesce(key_provider,'') !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then raise exception 'keyInvalid' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 -- A change whose begin the database did not take has no row yet: its finish records the hold all the same.
 insert into public.company_key_holds as h(company_id,provider,held,changing) values(c,key_provider,coalesce(now_held,false),false)
  on conflict (company_id,provider) do update set held=coalesce(now_held,h.held),changing=false
  returning h.held into kept;
 if not coalesce(kept,false) then return '{}'; end if;
 delete from public.agent_key_waits w using public.agent_profiles p
  where w.company_id=c and p.agent_id=w.agent_id and p.company_id=c and p.profile=any(coalesce(reached,'{}'));
 return array(select p.profile from public.agent_key_waits w join public.agent_profiles p on p.agent_id=w.agent_id and p.company_id=w.company_id
  where w.company_id=c order by w.id);
end $$;
revoke all on function public.finish_provider_key_change(uuid,text,boolean,text[]) from public,anon,authenticated;
grant execute on function public.finish_provider_key_change(uuid,text,boolean,text[]) to service_role;

-- The Owner's read settles the holds to what the Company's space holds (lib/provider-keys.mjs, queued with the
-- Company's key changes, so none is half done): every provider is held exactly when the space holds its key, and none
-- is changing. A seed the log got wrong, a change the Engine never answered, or one the previous app version made, is
-- right again from the next read.
create function public.settle_provider_key_holds(c uuid, held text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if held is null or exists(select 1 from unnest(held) p where coalesce(p,'') !~ '^[a-z0-9][a-z0-9._-]{0,63}$') then
  raise exception 'keyInvalid' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 update public.company_key_holds h set held=h.provider=any(settle_provider_key_holds.held),changing=false where h.company_id=c;
 insert into public.company_key_holds(company_id,provider,held,changing) select c,p,true,false from unnest(settle_provider_key_holds.held) p
  on conflict (company_id,provider) do nothing;
end $$;
revoke all on function public.settle_provider_key_holds(uuid,text[]) from public,anon,authenticated;
grant execute on function public.settle_provider_key_holds(uuid,text[]) to service_role;

-- 20261226000000's, replaced with one more argument: own_answers false when the Engine made the profile with the
-- level's tools but it has no model to answer with. While the Company holds a key, or a change of one is under way, the
-- Agent always gets its own profile, held until the Owner's next set unless it can answer: the one the Engine made, or
-- an owner record with no tools when the call names none («Make it», or an Engine that failed or refused), which the
-- worker makes as it makes a lost one. With no key held, everything is as before: a profile that cannot answer is no
-- place for the Agent yet, so it goes on Lead's.
drop function public.lead_create_agent(uuid,text,text,text,text,text[],text,text,integer,integer);
create function public.lead_create_agent(conversation uuid, run text, call text, agent_name text, job text, apps text[], template text default null, instructions text default null,
 own_level integer default null, own_policy integer default null, own_answers boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; linked public.hermes_connections; connection uuid; made uuid; held boolean; own boolean;
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
 select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=talk.agent_id;
 -- The owner record comes first: the Connection naming the profile and the Agent on it are checked against it. Its tool
 -- state is what was read back, not today's level: a change meanwhile is work for the worker and holds its Runs.
 if own then
  insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) values(agent,talk.company_id,own_level,own_policy);
 end if;
 insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state,version,features)
  values(talk.company_id,talk.person_id,linked.address,
   case when own then public.agent_engine_profile(agent) when linked.profile ~ '^ag-[0-9a-f]{32}$' then public.company_engine_profile(talk.company_id) else linked.profile end,
   linked.key_encrypted,linked.state,linked.version,linked.features) returning id into connection;
 insert into public.hermes_agents(id,company_id,connection_id,name,speciality,requested_by,apps,template,instructions)
  values(agent,talk.company_id,connection,trim(agent_name),trim(job),talk.person_id,array(select trim(app) from unnest(apps) app),template,
   replace(instructions,'{company}',(select c.name from public.companies c where c.id=talk.company_id))) returning id into made;
 insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id) values(conversation,run,call,talk.company_id,made);
 if held and (own_level is null or not own_answers) then insert into public.agent_key_waits(agent_id,company_id) values(made,talk.company_id); end if;
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

-- A removal left these removed Agents' profiles holding no key, or the Engine serves them no more (lib/provider-keys.mjs):
-- the next removal need not reach them. The Engine profile itself is kept.
create function public.forget_agent_profile_leftovers(c uuid, profiles text[]) returns void
language sql security definer set search_path='' as $$
 delete from public.agent_profile_leftovers l where l.company_id=c and l.profile=any(profiles);
$$;
revoke all on function public.forget_agent_profile_leftovers(uuid,text[]) from public,anon,authenticated;
grant execute on function public.forget_agent_profile_leftovers(uuid,text[]) to service_role;
