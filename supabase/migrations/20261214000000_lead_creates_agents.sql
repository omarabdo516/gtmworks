-- #13: the Owner tells the main Agent, Lead, what they need and Lead makes a lasting Agent at once. Lead is offered a
-- create_agent tool through the engine contract (lib/lead-tools.mjs); the model decides when to call it and the
-- database decides whether it is allowed, when the call is carried out: only in an active Owner's Conversation with
-- the Company's main Agent, while Lead runs on the Company's own profile in the bundled Engine (ADR 0014). The new Agent
-- shares that profile and keeps its own Connection to it, like every Agent of the Company.
--
-- Nothing existing is rewritten. The new columns are empty for every Agent made before (its made date is unknown, not
-- the day of this migration), and a run pinned before is never offered the tool.

alter table public.hermes_agents add column created_at timestamptz, add column requested_by uuid references public.people(id),
 add column apps text[], add column requester_opened_at timestamptz;
alter table public.hermes_agents alter column created_at set default now();

-- Whether Lead's tools go with a person's run: the Agent is the Company's main Agent on a bundled Connection to the
-- Company's own profile, and the person is an active Owner of the Company.
create function public.may_use_lead_tools(c uuid, agent uuid, person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role='owner' and m.removed_at is null)
  and exists(select 1 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id
   where a.id=agent and a.company_id=c and a.is_default and h.profile=public.company_engine_profile(c) and public.is_bundled_connection(h.id));
$$;
revoke all on function public.may_use_lead_tools(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- What a run offers is pinned with its note at its first reservation, so every retry sends the same request.
alter table public.conversation_run_notes add column offers_tools boolean not null default false;
create or replace function public.pinned_run_note(conversation uuid, message_key uuid, c uuid, person uuid) returns text
language plpgsql security definer set search_path='' as $$
declare kept text;
begin
 insert into public.conversation_run_notes(conversation_id,send_key,company_id,note,offers_tools)
  values(conversation,message_key,c,(select n.note from public.member_notes n where n.company_id=c and n.person_id=person),
   public.may_use_lead_tools(c,(select r.agent_id from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key),person))
  on conflict (conversation_id,send_key) do nothing;
 select r.note into kept from public.conversation_run_notes r where r.conversation_id=conversation and r.send_key=message_key;
 return kept;
end $$;
revoke all on function public.pinned_run_note(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.run_offers_tools(conversation uuid, message_key uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select r.offers_tools from public.conversation_run_notes r where r.conversation_id=conversation and r.send_key=message_key),false);
$$;
revoke all on function public.run_offers_tools(uuid,uuid) from public,anon,authenticated;
grant execute on function public.run_offers_tools(uuid,uuid) to service_role;

-- Each Agent Lead made, by the run and call that made it, for the card in its Conversation. Only lead_create_agent
-- writes it; the Conversation's own person reads it.
create table public.lead_made_agents (
 conversation_id uuid not null,
 run_id text not null,
 call_id text not null,
 company_id uuid not null references public.companies(id),
 agent_id uuid references public.hermes_agents(id) on delete set null,
 created_at timestamptz not null default now(),
 primary key (conversation_id,run_id,call_id),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id)
);
alter table public.lead_made_agents enable row level security;
create policy lead_made_agents_read on public.lead_made_agents for select to authenticated using (exists(select 1 from public.conversations c
 where c.id=conversation_id and c.company_id=lead_made_agents.company_id and c.person_id=auth.uid() and public.is_member(c.company_id)));
revoke all on public.lead_made_agents from anon,authenticated,service_role;
grant select on public.lead_made_agents to authenticated;

-- A create_agent call of a completed run, carried out by whoever closes the run (the worker, or a reader). It is
-- checked now, not when the message was sent: the Conversation's person must still be an active Owner. The answer is a
-- value, never an error, so a refused call cannot keep its run open. The same run and call again answer the Agent they
-- made and make nothing more, whichever closer comes second.
create function public.lead_create_agent(conversation uuid, run text, call text, agent_name text, job text, apps text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; linked public.hermes_connections; connection uuid; made uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select l.agent_id into made from public.lead_made_agents l where l.conversation_id=conversation and l.run_id=run and l.call_id=call;
 if found then return jsonb_build_object('state','created','agent',made); end if;
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not public.may_use_lead_tools(talk.company_id,talk.agent_id,talk.person_id) then return jsonb_build_object('state','refused'); end if;
 if coalesce(length(trim(agent_name)) between 1 and 100 and length(trim(job)) between 1 and 200 and cardinality(apps)<=8
  and not exists(select 1 from unnest(apps) app where coalesce(length(trim(app)),0) not between 1 and 40),false) is not true then
  return jsonb_build_object('state','invalid');
 end if;
 select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=talk.agent_id;
 insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state,version,features)
  values(talk.company_id,talk.person_id,linked.address,linked.profile,linked.key_encrypted,linked.state,linked.version,linked.features) returning id into connection;
 insert into public.hermes_agents(company_id,connection_id,name,speciality,requested_by,apps)
  values(talk.company_id,connection,trim(agent_name),trim(job),talk.person_id,array(select trim(app) from unnest(apps) app)) returning id into made;
 insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id) values(conversation,run,call,talk.company_id,made);
 insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
  values(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),made,'REQUEST_HERMES_AGENT',
   jsonb_build_object('connection_id',connection,'agent_name',trim(agent_name),'job',trim(job),'conversation_id',conversation));
 return jsonb_build_object('state','created','agent',made);
end $$;
revoke all on function public.lead_create_agent(uuid,text,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.lead_create_agent(uuid,text,text,text,text,text[]) to service_role;

-- The Agent's requester has opened it: its "new" mark goes, once, for them only.
create function public.open_hermes_agent(agent uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.hermes_agents set requester_opened_at=now() where id=agent and requested_by=auth.uid() and requester_opened_at is null and public.is_member(company_id);
 return found;
end $$;
revoke all on function public.open_hermes_agent(uuid) from public,anon,service_role;
grant execute on function public.open_hermes_agent(uuid) to authenticated;

-- A Connection Lead made is the worker's kind: bundled, so it is moved, forgotten and remade like the others.
create or replace function public.is_bundled_connection(connection uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hermes_agent_audit u where u.action in ('PROVIDE_BUNDLED_HERMES_AGENT','MOVE_COMPANY_PROFILE','REQUEST_HERMES_AGENT') and u.details->>'connection_id'=connection::text);
$$;
revoke all on function public.is_bundled_connection(uuid) from public,anon,authenticated,service_role;

-- The log names it, with the job the Agent was given.
create or replace function public.log_agent_action(action text) returns text language sql immutable set search_path='' as $$
 select case action when 'ATTACH_HERMES_AGENT' then 'agent_added' when 'DEFAULT_HERMES_AGENT' then 'agent_made_main'
  when 'REMOVE_HERMES_AGENT' then 'agent_removed' when 'PROVIDE_BUNDLED_HERMES_AGENT' then 'agent_provided'
  when 'MOVE_COMPANY_PROFILE' then 'agent_own_profile' when 'REQUEST_HERMES_AGENT' then 'agent_requested' else lower(action) end;
$$;
revoke all on function public.log_agent_action(text) from public,anon,authenticated,service_role;

create or replace function public.log_agent_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),coalesce(new.actor_name,(select name from public.people where id=new.actor_id)),
   'agent',new.agent_id,public.log_agent_action(new.action),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=new.agent_id),'replacement_id',new.details->'replacement_id','job',new.details->'job')),
   'hermes_agent_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_agent_change() from public,anon,authenticated,service_role;
