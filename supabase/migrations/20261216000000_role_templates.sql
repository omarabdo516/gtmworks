-- #14: Lead can start an Agent from a ready-made role (lib/role-templates.mjs). The app passes the role's id and its
-- instructions, which name the Company as {company}; the database puts in the Company's name and keeps both on the
-- Agent, and every run to that Agent carries the instructions (lib/conversation-runs.mjs). Nothing existing is
-- rewritten: an Agent made before has neither.
alter table public.hermes_agents add column template text, add column instructions text;
-- The worker reads them for a queued turn, by the claimed turn's Agent and Company.
grant select(instructions) on public.hermes_agents to service_role;

-- create_agent's spec changes here, and a start whose answer was lost is asked again with the same body until Hermes
-- names the run: another body under the same key is refused (409), so that turn would hold its Conversation's queue for
-- a day and then fail, its run never read. A run's tools are therefore pinned with its note before its first start
-- (pin_run_tools), as the exact text sent: jsonb would reorder their keys. A run pinned before offered #89's spec, which
-- it keeps. The previous app version serves on after these migrations until scripts/install.sh starts the new one, and
-- starts Lead's runs with #89's spec too: run_offers_tools, which it asks before every start, pins that spec for the run.
alter table public.conversation_run_notes add column tools text;
create function public.lead_tools_spec_89() returns text language sql immutable set search_path='' as $$
 select '[{"name":"create_agent","description":"Adds a lasting agent to the company''s team for a job the person asked someone to take on, such as running their Meta ads. Use it only when they asked for that.","parameters":{"type":"object","additionalProperties":false,"required":["name","job","apps"],"properties":{"name":{"type":"string","maxLength":100,"description":"A short name for the agent."},"job":{"type":"string","maxLength":200,"description":"One sentence: the work it does."},"apps":{"type":"array","maxItems":8,"items":{"type":"string","maxLength":40},"description":"The apps it will use."}}}}]'::text;
$$;
revoke all on function public.lead_tools_spec_89() from public,anon,authenticated,service_role;
update public.conversation_run_notes set tools=public.lead_tools_spec_89() where offers_tools and tools is null;
create function public.pin_run_tools(conversation uuid, message_key uuid, tools text) returns text language sql security definer set search_path='' as $$
 update public.conversation_run_notes r set tools=coalesce(r.tools,pin_run_tools.tools)
  where r.conversation_id=conversation and r.send_key=message_key and r.offers_tools returning r.tools;
$$;
revoke all on function public.pin_run_tools(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pin_run_tools(uuid,uuid,text) to service_role;
create or replace function public.run_offers_tools(conversation uuid, message_key uuid) returns boolean language sql security definer set search_path='' as $$
 with pinned as (update public.conversation_run_notes r set tools=coalesce(r.tools,public.lead_tools_spec_89())
  where r.conversation_id=conversation and r.send_key=message_key and r.offers_tools returning 1)
 select exists(select 1 from pinned);
$$;

-- Replaced, not overloaded: the previous app version's call names the first six arguments only, and the new ones default.
drop function public.lead_create_agent(uuid,text,text,text,text,text[]);
create function public.lead_create_agent(conversation uuid, run text, call text, agent_name text, job text, apps text[], template text default null, instructions text default null) returns jsonb
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
  and not exists(select 1 from unnest(apps) app where coalesce(length(trim(app)),0) not between 1 and 40)
  and (template is null or length(template) between 1 and 40) and (instructions is null or length(instructions) between 1 and 8000),false) is not true then
  return jsonb_build_object('state','invalid');
 end if;
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
revoke all on function public.lead_create_agent(uuid,text,text,text,text,text[],text,text) from public,anon,authenticated;
grant execute on function public.lead_create_agent(uuid,text,text,text,text,text[],text,text) to service_role;
