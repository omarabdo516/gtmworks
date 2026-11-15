-- #18: an Owner or a Manager changes an Agent by telling it a lasting rule in its Conversation, such as «من دلوقتي ما
-- تبعتش حاجة للعميل من غير ما أشوفها». The Agent is offered a save_rule tool through the engine contract
-- (lib/agent-tools.mjs); the model decides when to call it and the database decides, when the call is carried out,
-- whether the Conversation's person may still tell that Agent rules. The rule is kept for the Agent with who said it and
-- when, listed on the Agent's page, written in the Company's log, and sent with every later run of the Agent in the
-- run's instructions, pinned at the run's first reservation with its note. An Owner or a Manager removes a rule: it is
-- kept, marked removed, and the removal is logged too.
--
-- Nothing existing is rewritten. A run pinned before keeps what it was offered (offers_tools) and is told no rules, so
-- its retries send the request it first sent; the previous app version still reads offers_tools.

create table public.agent_rules (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 agent_id uuid references public.hermes_agents(id) on delete set null,
 body text not null check (length(body) between 1 and 500),
 said_by uuid not null references public.people(id),
 said_at timestamptz not null default now(),
 conversation_id uuid not null,
 run_id text not null,
 call_id text not null,
 removed_at timestamptz,
 removed_by uuid references public.people(id),
 unique (conversation_id,run_id,call_id),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id),
 check ((removed_at is null)=(removed_by is null))
);
create index agent_rules_by_agent on public.agent_rules(agent_id,said_at) where removed_at is null;
alter table public.agent_rules enable row level security;
-- Every Member reads the rules of their own Company's Agents (its page, and the saved line in the Conversation that told
-- one); only the functions below write them.
create policy agent_rules_read on public.agent_rules for select to authenticated using (public.is_member(company_id));
revoke all on public.agent_rules from anon,authenticated,service_role;
grant select on public.agent_rules to authenticated;

-- Who may tell an Agent a lasting rule, and remove one: an active Owner or Manager of the Company the Agent works in.
create function public.may_tell_agent_rules(c uuid, agent uuid, person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role in ('owner','manager') and m.removed_at is null)
  and exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c);
$$;
revoke all on function public.may_tell_agent_rules(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- The tools a person's run with an Agent is offered, by name.
create function public.run_tools(c uuid, agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[case when public.may_use_lead_tools(c,agent,person) then 'create_agent' end,
  case when public.may_tell_agent_rules(c,agent,person) then 'save_rule' end],null);
$$;
revoke all on function public.run_tools(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- An Agent's rules in force, oldest first.
create function public.agent_rules_in_force(agent uuid) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(r.body order by r.said_at,r.id),'{}') from public.agent_rules r where r.agent_id=agent and r.removed_at is null;
$$;
revoke all on function public.agent_rules_in_force(uuid) from public,anon,authenticated,service_role;

-- What a run is offered and told is pinned once, before its first start, so every retry sends the same request.
-- pinned_run_note keeps #13's body: the previous app version reserves through it and starts with offers_tools and the
-- note alone during an update. This version pins the rest itself, through pinned_run, only while no start was made: a
-- run the previous version already tried to start keeps what it sent, create_agent when offers_tools says so and no
-- rules. The reservation row is locked, as begin_start counts an attempt on it.
alter table public.conversation_run_notes add column tools text[], add column rules text[];
create function public.pinned_run(conversation uuid, message_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare held public.conversation_run_reservations; kept public.conversation_run_notes;
begin
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key for update;
 if found and held.start_attempts=0 and held.start_unknown_at is null then
  update public.conversation_run_notes n set tools=public.run_tools(held.company_id,held.agent_id,held.person_id),rules=public.agent_rules_in_force(held.agent_id)
   where n.conversation_id=conversation and n.send_key=message_key and n.tools is null;
 end if;
 select * into kept from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key;
 if not found then return null; end if;
 return jsonb_build_object('tools',to_jsonb(coalesce(kept.tools,case when kept.offers_tools then array['create_agent'] else '{}'::text[] end)),
  'rules',to_jsonb(coalesce(kept.rules,'{}'::text[])));
end $$;
revoke all on function public.pinned_run(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pinned_run(uuid,uuid) to service_role;

-- A save_rule call of a completed run, carried out by whoever closes the run (the worker, or a reader). It is checked
-- now, not when the message was sent: the Conversation's person must still be an active Owner or Manager of its Company
-- and its Agent still there. The answer is a value, never an error, so a refused call cannot keep its run open. The
-- same run and call again answer the rule they saved and save nothing more, whichever closer comes second.
create function public.agent_save_rule(conversation uuid, run text, call text, rule text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; said text:=btrim(rule,E' \t\r\n'); saved uuid;
begin
 select r.id into saved from public.agent_rules r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 if found then return jsonb_build_object('state','saved','rule',saved); end if;
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not public.may_tell_agent_rules(talk.company_id,talk.agent_id,talk.person_id) then return jsonb_build_object('state','refused'); end if;
 if coalesce(length(said) between 1 and 500,false) is not true then return jsonb_build_object('state','invalid'); end if;
 -- A lasting rule is what the person said, never text the model read elsewhere: it is saved only when it is in the
 -- person's own message of that run, whatever its case and spacing.
 if not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run
  and position(lower(regexp_replace(said,'\s+',' ','g')) in lower(regexp_replace(m.body,'\s+',' ','g')))>0) then
  return jsonb_build_object('state','refused');
 end if;
 insert into public.agent_rules(company_id,agent_id,body,said_by,conversation_id,run_id,call_id)
  values(talk.company_id,talk.agent_id,said,talk.person_id,conversation,run,call)
  on conflict (conversation_id,run_id,call_id) do nothing returning id into saved;
 if saved is null then
  select r.id into saved from public.agent_rules r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
  return jsonb_build_object('state','saved','rule',saved);
 end if;
 insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
  values(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),talk.agent_id,'AGENT_RULE_SAVED',
   jsonb_build_object('rule',said,'rule_id',saved,'conversation_id',conversation));
 return jsonb_build_object('state','saved','rule',saved);
end $$;
revoke all on function public.agent_save_rule(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.agent_save_rule(uuid,text,text,text) to service_role;

-- An Owner or a Manager of the rule's Company removes it, from the Agent's page. It is kept with who removed it and
-- when, and the removal is logged once. A rule of another Company is not found.
create function public.remove_agent_rule(c uuid, rule uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare kept public.agent_rules;
begin
 select * into kept from public.agent_rules r where r.id=rule and r.company_id=c and r.agent_id is not null for update;
 if not found or not public.is_member(c) then raise exception 'agentRuleNotFound' using errcode='P0002'; end if;
 if not public.may_tell_agent_rules(c,kept.agent_id,auth.uid()) then raise exception 'agentRuleNotAllowed' using errcode='42501'; end if;
 if kept.removed_at is not null then return false; end if;
 update public.agent_rules set removed_at=now(),removed_by=auth.uid() where id=rule;
 insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
  values(c,auth.uid(),(select name from public.people where id=auth.uid()),kept.agent_id,'AGENT_RULE_REMOVED',jsonb_build_object('rule',kept.body,'rule_id',rule));
 return true;
end $$;
revoke all on function public.remove_agent_rule(uuid,uuid) from public,anon,service_role;
grant execute on function public.remove_agent_rule(uuid,uuid) to authenticated;

-- The log names the rule (log_agent_action reads AGENT_RULE_SAVED and AGENT_RULE_REMOVED as agent_rule_saved and
-- agent_rule_removed).
create or replace function public.log_agent_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),coalesce(new.actor_name,(select name from public.people where id=new.actor_id)),
   'agent',new.agent_id,public.log_agent_action(new.action),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=new.agent_id),'replacement_id',new.details->'replacement_id','job',new.details->'job','rule',new.details->'rule')),
   'hermes_agent_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_agent_change() from public,anon,authenticated,service_role;
