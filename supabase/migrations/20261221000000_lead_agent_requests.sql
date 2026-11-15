-- #17: a Manager or a Contributor asks Lead for an Agent. Lead is offered request_agent in their runs where an Owner's are
-- offered create_agent (lib/agent-tools.mjs), and its call is kept as a request: the create call Lead would have carried
-- out for an Owner, held under the same key (the Conversation, run and call) until an active Owner answers it from
-- "Waiting on you". «Make it» carries out that same call through lead_create_agent, so the Agent is made exactly as in
-- the Owner's own flow, and shown to the Member who asked; «No» needs a reason, which goes to that Member's Conversation
-- with Lead. The request row is the one record: the Owners' list, the Member's card and the answer are read from it.
--
-- Nothing existing is rewritten. The previous app version runs against this: it calls the same functions, it is never
-- offered request_agent (its tool texts have none, and pin_run offers only what the app gives), and it draws a waiting
-- agent_request row as a plain item.

-- Lead on the Company's own profile in the bundled Engine (ADR 0014): whom Lead's tools go with.
create function public.is_company_lead(c uuid, agent uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id
  where a.id=agent and a.company_id=c and a.is_default and h.profile=public.company_engine_profile(c) and public.is_bundled_connection(h.id));
$$;
revoke all on function public.is_company_lead(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.may_use_lead_tools(c uuid, agent uuid, person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role='owner' and m.removed_at is null)
  and public.is_company_lead(c,agent);
$$;

-- An active Manager or Contributor talking to Lead asks for an Agent instead.
create function public.may_ask_lead_for_agents(c uuid, agent uuid, person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role in ('manager','contributor') and m.removed_at is null)
  and public.is_company_lead(c,agent);
$$;
revoke all on function public.may_ask_lead_for_agents(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- What a create call may carry: the one rule lead_create_agent and a request share.
create function public.agent_fields_valid(agent_name text, job text, apps text[], template text, instructions text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(length(trim(agent_name)) between 1 and 100 and length(trim(job)) between 1 and 200 and cardinality(apps)<=8
  and not exists(select 1 from unnest(apps) app where coalesce(length(trim(app)),0) not between 1 and 40)
  and (template is null or length(template) between 1 and 40) and (instructions is null or length(instructions) between 1 and 8000),false);
$$;
revoke all on function public.agent_fields_valid(text,text,text[],text,text) from public,anon,authenticated,service_role;

-- `asked_by` and `asked_with` (the person's message of that run) are copied from the Conversation, which the Owner
-- cannot read. A role's instructions are kept as given, naming the Company as {company}: they are fitted when the Agent
-- is made. The Agent made for a request is lead_made_agents' row under the same key.
create table public.lead_agent_requests (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 conversation_id uuid not null,
 run_id text not null,
 call_id text not null,
 asked_by uuid not null references public.people(id),
 asked_with text not null,
 agent_name text not null,
 job text not null,
 apps text[] not null,
 template text,
 instructions text,
 state text not null default 'waiting' check (state in ('waiting','made','declined')),
 answered_by uuid references public.people(id),
 answered_at timestamptz,
 reason text check (length(btrim(reason)) between 1 and 1000),
 created_at timestamptz not null default now(),
 unique (conversation_id,run_id,call_id),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id),
 constraint lead_agent_requests_fields check (public.agent_fields_valid(agent_name,job,apps,template,instructions)),
 constraint lead_agent_requests_answer check ((state='waiting')=(answered_by is null) and (answered_by is null)=(answered_at is null) and (state='declined')=(reason is not null))
);
create index lead_agent_requests_waiting on public.lead_agent_requests(company_id,created_at) where state='waiting';
alter table public.lead_agent_requests enable row level security;
-- The Member who asked reads their own; the Company's active Owners read every one. A Manager reads none but their own.
create policy lead_agent_requests_read on public.lead_agent_requests for select to authenticated
 using (public.is_member(company_id) and (asked_by=auth.uid() or public.is_company_owner(company_id)));
revoke all on public.lead_agent_requests from anon,authenticated,service_role;
grant select on public.lead_agent_requests to authenticated;

create or replace function public.run_tools(c uuid, agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[
  case when public.may_use_lead_tools(c,agent,person) then 'create_agent' when public.may_ask_lead_for_agents(c,agent,person) then 'request_agent' end,
  case when public.may_tell_agent_rules(c,agent,person) then 'save_rule' when public.may_suggest_agent_rules(c,agent,person) then 'suggest_rule' end],null);
$$;

-- A request_agent call of a completed run, carried out by whoever closes it (the worker, or a reader), as a create_agent
-- call is. The Conversation's person must still be an active Manager or Contributor talking to the Company's Lead. It
-- keeps the call as their request and makes nothing; the same run and call again answer the request they kept.
create function public.lead_request_agent(conversation uuid, run text, call text, agent_name text, job text, apps text[], template text default null, instructions text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked text; kept public.lead_agent_requests;
begin
 select * into kept from public.lead_agent_requests r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 if found then return jsonb_build_object('state','requested','request',kept.id); end if;
 select * into talk from public.conversations where id=conversation;
 if not found then return jsonb_build_object('state','refused'); end if;
 select m.body into asked from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run order by m.id limit 1;
 if asked is null or not public.may_ask_lead_for_agents(talk.company_id,talk.agent_id,talk.person_id) then return jsonb_build_object('state','refused'); end if;
 if not public.agent_fields_valid(agent_name,job,apps,template,instructions) then return jsonb_build_object('state','invalid'); end if;
 insert into public.lead_agent_requests(company_id,conversation_id,run_id,call_id,asked_by,asked_with,agent_name,job,apps,template,instructions)
  values(talk.company_id,conversation,run,call,talk.person_id,asked,trim(agent_name),trim(job),array(select trim(app) from unnest(apps) app),template,instructions)
  on conflict (conversation_id,run_id,call_id) do nothing returning * into kept;
 if kept.id is null then
  select * into kept from public.lead_agent_requests r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 else
  insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
   values(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),talk.agent_id,'AGENT_REQUEST_SENT',
    jsonb_build_object('asked_for',kept.agent_name,'job',kept.job,'request_id',kept.id,'conversation_id',conversation,'private','owners','teller',talk.person_id));
 end if;
 return jsonb_build_object('state','requested','request',kept.id);
end $$;
revoke all on function public.lead_request_agent(uuid,text,text,text,text,text[],text,text) from public,anon,authenticated;
grant execute on function public.lead_request_agent(uuid,text,text,text,text,text[],text,text) to service_role;

-- Replaced in place (the previous app version's call names the first six arguments only). Who may: an Owner's own call,
-- as before, or a Member's call an active Owner answered «Make it» (answer_agent_request). The rest is the Owner's flow
-- for either: the Agent's requester is the Conversation's person.
create or replace function public.lead_create_agent(conversation uuid, run text, call text, agent_name text, job text, apps text[], template text default null, instructions text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; linked public.hermes_connections; connection uuid; made uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select l.agent_id into made from public.lead_made_agents l where l.conversation_id=conversation and l.run_id=run and l.call_id=call;
 if found then return jsonb_build_object('state','created','agent',made); end if;
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not (public.may_use_lead_tools(talk.company_id,talk.agent_id,talk.person_id)
   or exists(select 1 from public.lead_agent_requests r where r.conversation_id=conversation and r.run_id=run and r.call_id=call and r.state='made'
    and public.may_use_lead_tools(talk.company_id,talk.agent_id,r.answered_by))) then return jsonb_build_object('state','refused'); end if;
 if not public.agent_fields_valid(agent_name,job,apps,template,instructions) then return jsonb_build_object('state','invalid'); end if;
 select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=talk.agent_id;
 insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state,version,features)
  values(talk.company_id,talk.person_id,linked.address,linked.profile,linked.key_encrypted,linked.state,linked.version,linked.features) returning id into connection;
 insert into public.hermes_agents(company_id,connection_id,name,speciality,requested_by,apps,template,instructions)
  values(talk.company_id,connection,trim(agent_name),trim(job),talk.person_id,array(select trim(app) from unnest(apps) app),template,
   replace(instructions,'{company}',(select c.name from public.companies c where c.id=talk.company_id))) returning id into made;
 insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id) values(conversation,run,call,talk.company_id,made);
 insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
  values(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),made,'REQUEST_HERMES_AGENT',
   jsonb_strip_nulls(jsonb_build_object('connection_id',connection,'agent_name',trim(agent_name),'job',trim(job),'conversation_id',conversation,'template',template)));
 return jsonb_build_object('state','created','agent',made);
end $$;

-- An active Owner answers a Member's request once, from "Waiting on you". «Make it» makes the Agent as the Owner's own
-- call would and shows it to the Member who asked; a request that cannot be made now (Lead is no longer the Company's
-- main Agent on its own profile) stays waiting. «No» needs a reason, which goes to that Member. The same answer again
-- answers the same and logs nothing more; the other answer is refused.
create function public.answer_agent_request(c uuid, request bigint, make boolean, reason text default null) returns text
language plpgsql security definer set search_path='' as $$
declare asked public.lead_agent_requests; wanted text:=case when make then 'made' when not make then 'declined' end;
 said text:=nullif(btrim(reason,E' \t\r\n'),''); done jsonb; asker text;
begin
 if wanted is null then raise exception 'agentRequestAnswerMissing' using errcode='22023'; end if;
 if not public.is_company_owner(c) then raise exception 'agentRequestNotAllowed' using errcode='42501'; end if;
 select * into asked from public.lead_agent_requests r where r.id=request and r.company_id=c for update;
 if not found or not exists(select 1 from public.members m where m.company_id=c and m.person_id=asked.asked_by and m.removed_at is null) then
  raise exception 'agentRequestNotFound' using errcode='P0002';
 end if;
 if asked.state=wanted then return wanted; end if;
 if asked.state<>'waiting' then raise exception 'agentRequestAnswered' using errcode='22023'; end if;
 asker:=(select name from public.people where id=asked.asked_by);
 if make then
  update public.lead_agent_requests set state='made',answered_by=auth.uid(),answered_at=now() where id=asked.id;
  done:=public.lead_create_agent(asked.conversation_id,asked.run_id,asked.call_id,asked.agent_name,asked.job,asked.apps,asked.template,asked.instructions);
  if done->>'state' is distinct from 'created' then raise exception 'agentRequestNotMade' using errcode='55000'; end if;
  -- An Owner sees every Agent and never has a row (20261216150000).
  insert into public.member_agent_access(company_id,person_id,agent_id)
   select c,asked.asked_by,(done->>'agent')::uuid
   where not exists(select 1 from public.members m where m.company_id=c and m.person_id=asked.asked_by and m.role='owner' and m.removed_at is null)
   on conflict do nothing;
  insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
   values(c,auth.uid(),(select name from public.people where id=auth.uid()),(done->>'agent')::uuid,'AGENT_REQUEST_MADE',jsonb_build_object('asked_by',asker,'request_id',asked.id));
 else
  if said is null or length(said)>1000 then raise exception 'agentRequestReasonMissing' using errcode='22023'; end if;
  update public.lead_agent_requests set state='declined',answered_by=auth.uid(),answered_at=now(),reason=said where id=asked.id;
  insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
   values(c,auth.uid(),(select name from public.people where id=auth.uid()),(select v.agent_id from public.conversations v where v.id=asked.conversation_id),'AGENT_REQUEST_DECLINED',
    jsonb_build_object('asked_for',asked.agent_name,'asked_by',asker,'reason',said,'request_id',asked.id,'private','owners','teller',asked.asked_by));
 end if;
 return wanted;
end $$;
revoke all on function public.answer_agent_request(uuid,bigint,boolean,text) from public,anon,service_role;
grant execute on function public.answer_agent_request(uuid,bigint,boolean,text) to authenticated;

-- "Waiting on you" (#16): a request waits on every active Owner while it waits, derived as an approval is. An Owner made
-- later sees it, an Owner made a Manager stops seeing it, and the first answer takes it off every list. The Member who
-- asked reads the row too, hence the Owner filter; a request whose Member has left waits on no one.
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
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;

-- A request's sending and its refusal stay with the Member who asked and the Company's Owners in the log (`private`
-- 'owners'); #25's `private` rows stay readable by Managers too. «Make it» is for everyone who sees the new Agent.
-- log_agent_action reads AGENT_REQUEST_SENT, AGENT_REQUEST_MADE and AGENT_REQUEST_DECLINED as agent_request_sent,
-- agent_request_made and agent_request_declined.
alter policy hermes_agent_audit_read on public.hermes_agent_audit using (public.is_member(company_id) and public.can_see_agent(company_id,agent_id)
 and (details->>'private' is null or actor_id=auth.uid() or details->>'teller'=auth.uid()::text
  or case when details->>'private'='owners' then public.is_company_owner(company_id) else public.can_manage_company(company_id) end));
alter policy company_log_read on public.company_log using (public.is_member(company_id) and public.can_see_agent(company_id,agent_id) and public.can_see_agent(company_id,actor_id)
 and (details->>'private' is null or actor_id=auth.uid() or details->>'teller'=auth.uid()::text
  or case when details->>'private'='owners' then public.is_company_owner(company_id) else public.can_manage_company(company_id) end));
create or replace function public.log_agent_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),coalesce(new.actor_name,(select name from public.people where id=new.actor_id)),
   'agent',new.agent_id,public.log_agent_action(new.action),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=new.agent_id),'replacement_id',new.details->'replacement_id','job',new.details->'job','rule',new.details->'rule','taught_by',new.details->'taught_by','asked_for',new.details->'asked_for','asked_by',new.details->'asked_by','reason',new.details->'reason','private',new.details->'private','teller',new.details->'teller')),
   'hermes_agent_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
