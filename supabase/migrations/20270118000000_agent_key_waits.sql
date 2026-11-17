-- #299: once a Company holds a provider key, an Agent Lead makes later never runs on Lead's profile. lead_create_agent
-- attaches it to its own profile, `ag-<agent>`: the one the Engine made for the call with no key and no model (a clone
-- would copy the shared space's Skills, #124), or, when the Engine could not provide one or none was asked for («Make
-- it»), an owner record with no tools, which the worker makes as it makes a lost one. Unless the Engine made it able to
-- answer, the Agent is held (agent_key_waits): every Run entry refuses it as agentLevelPending, and the Owner sees it in
-- "Waiting on you" until a key set gives its profile key and model, or the Company is found to hold no key at all. Then
-- it runs on its own profile without one, answering only where that profile can, and never on Lead's. A removed Agent's
-- profile stays in the Engine, so its name is kept (agent_profile_leftovers) and company_key_profiles lists it for the
-- next key removal, until a removal or the Owner's read finds it holding no key.
--
-- Whether the Company holds a key is company_key_holds, written only by the server through the service role:
-- begin_provider_key_change before the Engine is asked anything, under the lock lead_create_agent takes, so an Agent made
-- while a change is under way waits; finish_provider_key_change with the Engine's answer, under that lock too; and
-- settle_provider_key_holds with what the Company's space holds, read by the Owner's read or, once a set the Engine
-- never answered is ten minutes old, by Lead's next create (lead_key_settle). A change counts for ten minutes from its
-- begin, so a process that died mid-change holds no Company for good. A set the Engine never answered may have landed,
-- so it counts until the space settles it: an Agent made meanwhile waits on its own profile, never on Lead's, and an
-- Engine that cannot say leaves it counted. finish and settle are the only ends of a wait, so no Owner ends one from
-- the browser.
--
-- Nothing existing is rewritten: the new tables start empty but company_key_holds, which is filled once from each
-- Company's last set or removal of each provider's key in its log, and agent_profile_leftovers, which is filled once with
-- the Agents removed before this version in a Company that has set a key; the trigger writes only on a later removal;
-- and with no key held, no wait and no leftover every replaced function answers as before. The previous app version runs against
-- this. Its create calls name at most ten arguments and reach the new function with own_answers true, the path they took
-- before, but while the Company holds a key a call with no own profile (its Engine failed or refused, or the profile had
-- no model, which that version does not pass on) makes the Agent on an owner record with no tools, waiting, instead of
-- on Lead's profile; its worker makes that profile as it makes a lost one, and its «Make it» does the same. Its key
-- routes never begin or finish a change, so a set or removal it makes leaves company_key_holds as it was, ends no wait
-- and forgets no leftover, and they read only the 'company' and 'agent' kinds. Its "Waiting on you" draws a wait as a row
-- whose link opens a missing card, and renders without error. So while it runs, during an update or after a rollback,
-- such an Agent waits until this version's next set, and the holds are right again from this version's next Owner read
-- (settle_provider_key_holds).

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
-- An Agent removed before this version, in a Company that has set a key, may have left its own profile holding it: its
-- name is kept as the trigger below would have, named as Lead was last asked to make it, so the next removal reaches it.
-- A profile the Engine never made reads as missing and is forgotten at the next Owner's read or removal.
insert into public.agent_profile_leftovers(profile,company_id,agent_id,agent_name)
 select public.agent_engine_profile(r.agent_id),r.company_id,r.agent_id,
  (select q.details->>'agent_name' from public.hermes_agent_audit q
    where q.company_id=r.company_id and q.agent_id=r.agent_id and q.action='REQUEST_HERMES_AGENT' order by q.id desc limit 1)
 from public.hermes_agent_audit r
 where r.action='REMOVE_HERMES_AGENT' and not exists(select 1 from public.hermes_agents a where a.id=r.agent_id)
  and exists(select 1 from public.company_audit k where k.company_id=r.company_id and k.action='provider_key_set')
 on conflict (profile) do nothing;

-- Whether the Company holds a provider's key, as the server last recorded the Engine's answer, and `changing` from the
-- start of a set or removal until that answer is recorded. The Engine says whether a profile holds a key only when asked
-- over the network, so the create path reads this instead. Provider names only, never a key.
create table public.company_key_holds (
 company_id uuid not null references public.companies(id) on delete cascade,
 provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
 held boolean not null,
 changing boolean not null default false,
 -- A set the Engine never answered may have landed: it counts as held until a set the Engine answered with a write, or
 -- a read of the space, settles it. A read keeps it within the window below even when the space does not show the key.
 uncertain boolean not null default false,
 -- When the last change began, or a set was finished unanswered: the start of the window in which a change counts, and
 -- in which a read keeps an unanswered set held although the space does not show its key.
 changed_at timestamptz,
 primary key (company_id,provider)
);
alter table public.company_key_holds enable row level security;
revoke all on public.company_key_holds from anon,authenticated,service_role;
-- Before this version, only the log knew: a provider's last set or removal there is its hold, with no change under way,
-- so after the update an Agent waits only in a Company whose log says it holds a key. A set whose log write failed is
-- missing from it; the Owner's next read settles that hold to what the space holds.
insert into public.company_key_holds(company_id,provider,held,changing)
 select distinct on (a.company_id,a.provider) a.company_id,a.provider,a.action='provider_key_set',false from public.company_audit a
  where a.action in ('provider_key_set','provider_key_removed') order by a.company_id,a.provider,a.created_at desc,a.id desc;

-- Some provider's key is held, a change of one began within ten minutes, or a set of one went unanswered and the space has
-- not settled it yet: an Agent made now waits for the Owner's next set.
create function public.company_holds_provider_key(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.company_key_holds h where h.company_id=c
  and (h.held or (h.changing and h.changed_at>now()-interval '10 minutes') or h.uncertain));
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
 insert into public.company_key_holds(company_id,provider,held,changing,changed_at) values(c,key_provider,false,true,now())
  on conflict (company_id,provider) do update set changing=true,changed_at=now();
end $$;
revoke all on function public.begin_provider_key_change(uuid,text) from public,anon,authenticated;
grant execute on function public.begin_provider_key_change(uuid,text) to service_role;

-- How the Engine answered the change: now_held true for a set it took, false for a removal, null for any other answer
-- (the key is as it was). The server finishes every change it began, as held when it cannot tell how a set ended, with
-- answered false: that set is marked uncertain from now. Only a set the Engine answered with a write clears the mark; a
-- removal or a change that wrote nothing (answered null) leaves it, since the unanswered set may land after them. While
-- the key is held, the waits of the Agents whose profile the set gave key and model (reached) end, and the answer is the
-- Company's Agent profiles still waiting, which an Agent made during the set waits on: the server gives those the key and
-- finishes again. Once the Company holds no key of any provider, nothing is left to wait for, and every wait ends.
create function public.finish_provider_key_change(c uuid, key_provider text, now_held boolean, reached text[], answered boolean default true) returns text[]
language plpgsql security definer set search_path='' as $$
declare kept boolean;
begin
 if coalesce(key_provider,'') !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then raise exception 'keyInvalid' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 -- A change whose begin the database did not take has no row yet: its finish records the hold all the same.
 insert into public.company_key_holds as h(company_id,provider,held,changing,uncertain,changed_at)
  values(c,key_provider,case when not answered then false else coalesce(now_held,false) end,false,coalesce(not answered,false),case when not answered then now() end)
  -- An unanswered set keeps the hold the Company had: its mark holds the Company's Agents until the space settles it.
  on conflict (company_id,provider) do update set held=case when not answered then h.held else coalesce(now_held,h.held) end,changing=false,
   uncertain=case when not answered then true when answered and now_held then false else h.uncertain end,
   changed_at=case when not answered then now() else h.changed_at end
  returning h.held into kept;
 if not public.company_holds_provider_key(c) then
  delete from public.agent_key_waits w where w.company_id=c;
  return '{}';
 end if;
 if not coalesce(kept,false) then return '{}'; end if;
 delete from public.agent_key_waits w using public.agent_profiles p
  where w.company_id=c and p.agent_id=w.agent_id and p.company_id=c and p.profile=any(coalesce(reached,'{}'));
 return array(select p.profile from public.agent_key_waits w join public.agent_profiles p on p.agent_id=w.agent_id and p.company_id=w.company_id
  where w.company_id=c order by w.id);
end $$;
revoke all on function public.finish_provider_key_change(uuid,text,boolean,text[],boolean) from public,anon,authenticated;
grant execute on function public.finish_provider_key_change(uuid,text,boolean,text[],boolean) to service_role;

-- The Owner's read settles the holds to what the Company's space holds (lib/provider-keys.mjs). A change begun within
-- the window is left alone, since another process may still be writing it. Every other provider is held exactly when
-- the space holds its key, but for a set the Engine never answered, within the window, whose key the space does not
-- show yet: it may still land, so it stays held. A space holding the key clears that mark, and past the window the hold
-- goes with it. A seed the log got wrong, or a change the previous app version made, is right again from the next read.
-- A name that is no provider's is skipped, so one odd name the Engine lists never keeps a Company unsettled. A space
-- holding no key ends every wait, as a removal does.
create function public.settle_provider_key_holds(c uuid, held text[]) returns void
language plpgsql security definer set search_path='' as $$
declare since timestamptz:=now()-interval '10 minutes';
begin
 if held is null then raise exception 'keyInvalid' using errcode='22023'; end if;
 -- Each row's new values are computed once, from the row as read; a row another change wrote meanwhile is a newer row
 -- (ctid), left as that change wrote it for the next read. A row left as it was is not written, and no lock is taken, so
 -- a page read queues behind no other Company's Agents or key changes.
 update public.company_key_holds h set held=n.held,changing=false,uncertain=n.uncertain
  from (select k.ctid as seen,coalesce(k.provider=any(settle_provider_key_holds.held),false) as held,
    k.uncertain and coalesce(k.changed_at>since,false) and not coalesce(k.provider=any(settle_provider_key_holds.held),false) as uncertain
   from public.company_key_holds k where k.company_id=c and not (k.changing and coalesce(k.changed_at>since,false))) n
  where h.ctid=n.seen and (h.held,h.changing,h.uncertain) is distinct from (n.held,false,n.uncertain);
 insert into public.company_key_holds(company_id,provider,held,changing)
  select c,p,true,false from unnest(settle_provider_key_holds.held) p where p ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  on conflict (company_id,provider) do nothing;
 if not public.company_holds_provider_key(c) then
  -- lead_create_agent's lock, so no Agent is made waiting meanwhile; a change begun before it was taken is seen here.
  perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
  delete from public.agent_key_waits w where w.company_id=c and not public.company_holds_provider_key(c);
 end if;
end $$;
revoke all on function public.settle_provider_key_holds(uuid,text[]) from public,anon,authenticated;
grant execute on function public.settle_provider_key_holds(uuid,text[]) to service_role;

-- Lead's next create settles a set the Engine never answered once its window has passed (lib/agent-tools.mjs), so an
-- Owner who never opens the key page does not leave the Company's Agents waiting for good: the Conversation's Company and
-- its shared space, whose keys the server reads from the Engine. Null when no such set waits or the Company has no space.
create function public.lead_key_settle(conversation uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('company',v.company_id,'space',s.profile) from public.conversations v
  join public.company_shared_spaces s on s.company_id=v.company_id
  where v.id=conversation and exists(select 1 from public.company_key_holds h where h.company_id=v.company_id and h.uncertain
   and not coalesce(h.changed_at>now()-interval '10 minutes',false));
$$;
revoke all on function public.lead_key_settle(uuid) from public,anon,authenticated;
grant execute on function public.lead_key_settle(uuid) to service_role;

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
  when exists(select 1 from public.agent_key_waits w where w.agent_id=agent and w.company_id=c) and public.company_holds_provider_key(c) then 'agentLevelPending'
  when not exists(select 1 from public.agent_profiles p join public.companies co on co.id=p.company_id
   where p.agent_id=agent and p.tools_level=co.agent_level and p.tools_policy=public.engine_tool_policy() and not p.tools_pending and (p.skills_shared or not public.shared_skills_active(c))) then 'agentLevelPending'
 end;
$$;

-- Whether the reader is an active Owner of a Company whose Agents wait for its key now: a wait counts only while the
-- Company holds one, so one left past a change that never landed neither holds Runs nor fills "Waiting on you".
create function public.agent_key_waits_shown(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_company_owner(c) and public.company_holds_provider_key(c);
$$;
revoke all on function public.agent_key_waits_shown(uuid) from public,anon,service_role;
grant execute on function public.agent_key_waits_shown(uuid) to authenticated;

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
   where k.company_id=c and public.agent_key_waits_shown(c)
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
