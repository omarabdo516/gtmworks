-- #25: in a team, a lasting rule a Contributor tells an Agent is a learning suggestion. It is kept as the Agent's rule
-- with `suggestion` 'pending': it goes with that Contributor's own later runs of the Agent at once, and with everyone's
-- once an Owner or a Manager approves it ('approved') from "Waiting on you"; refused ('rejected'), it stays in the
-- Contributor's own runs only. A rule an Owner or a Manager tells keeps `suggestion` null and applies to everyone at once,
-- as before. The row is the one record: who a rule reaches, who reads it, what each run is told and the lines in the
-- Contributor's Conversation are all read from it.
--
-- The suggestion waits as one waiting_items row of kind rule_suggestion for each active Owner or Manager who sees the
-- Agent when it is told; the first decision resolves them all. Accepted gap: an Owner or a Manager added after the
-- suggestion was told has no row for it.
--
-- Nothing existing is rewritten: every rule kept so far has `suggestion` null. The previous app version runs against
-- this: it calls the same functions, it is never offered suggest_rule (its tool texts have none, and pin_run offers only
-- what the app gives), and it draws a waiting rule_suggestion row as a plain item.

alter table public.agent_rules
 add column suggestion text check (suggestion in ('pending','approved','rejected')),
 add column decided_by uuid references public.people(id),
 add column decided_at timestamptz,
 add constraint agent_rules_decision check ((decided_by is null)=(decided_at is null) and coalesce(suggestion in ('approved','rejected'),false)=(decided_by is not null));

-- A pending or refused suggestion is read only by the person who told it and the Company's Owners and Managers.
alter policy agent_rules_read on public.agent_rules using (public.is_member(company_id) and public.can_see_agent(company_id,agent_id)
 and (suggestion is null or suggestion='approved' or said_by=auth.uid() or public.can_manage_company(company_id)));

-- Who may suggest a rule: an active Contributor of the Company the Agent works in, who sees that Agent (#15).
create function public.may_suggest_agent_rules(c uuid, agent uuid, person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role='contributor' and m.removed_at is null)
  and exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c) and public.agent_visible_to(c,person,agent);
$$;
revoke all on function public.may_suggest_agent_rules(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- An Owner's or a Manager's run is offered save_rule, a Contributor's suggest_rule (lib/agent-tools.mjs), a Viewer's
-- neither.
create or replace function public.run_tools(c uuid, agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[case when public.may_use_lead_tools(c,agent,person) then 'create_agent' end,
  case when public.may_tell_agent_rules(c,agent,person) then 'save_rule' when public.may_suggest_agent_rules(c,agent,person) then 'suggest_rule' end],null);
$$;

-- The rules a person's run of an Agent is told, oldest first: the team's (told by an Owner or a Manager, or approved),
-- and that person's own suggestions, waiting or refused. Without a person, the team's.
create function public.agent_rules_in_force(agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(r.body order by r.said_at,r.id),'{}') from public.agent_rules r
  where r.agent_id=agent and r.removed_at is null and (r.suggestion is null or r.suggestion='approved' or r.said_by=person);
$$;
revoke all on function public.agent_rules_in_force(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.agent_rules_in_force(agent uuid) returns text[] language sql stable security definer set search_path='' as $$
 select public.agent_rules_in_force(agent,null);
$$;

create or replace function public.pin_run(conversation uuid, message_key uuid, specs jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare held public.conversation_run_reservations; kept public.conversation_run_notes; offered text[];
begin
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key for update;
 select * into kept from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if kept.conversation_id is null then return null; end if;
 if kept.rules is null and held.conversation_id is not null and held.start_attempts=0 and held.start_unknown_at is null then
  offered:=array(select t from unnest(public.run_tools(held.company_id,held.agent_id,held.person_id)) t where jsonb_typeof(specs->t)='string');
  update public.conversation_run_notes n set
   tools=case when cardinality(offered)>0 then '['||(select string_agg(specs->>t,',' order by o) from unnest(offered) with ordinality u(t,o))||']' end,
   rules=public.agent_rules_in_force(held.agent_id,held.person_id)
   where n.conversation_id=conversation and n.send_key=message_key returning * into kept;
 end if;
 return jsonb_build_object('tools',kept.tools,'rules',to_jsonb(coalesce(kept.rules,'{}'::text[])));
end $$;

-- What waits on whom: a learning suggestion names its rule. It shows only to someone who may still decide it, an active
-- Owner or Manager who sees its Agent (#15).
alter table public.waiting_items add column agent_rule_id uuid references public.agent_rules(id);
alter table public.waiting_items drop constraint waiting_items_check;
alter table public.waiting_items add constraint waiting_items_source check (card_id is not null or conversation_id is not null or agent_rule_id is not null);
create index waiting_items_by_rule on public.waiting_items(agent_rule_id) where agent_rule_id is not null and resolved_at is null;
create function public.can_decide_waiting_rule(c uuid, rule uuid) returns boolean language sql stable security definer set search_path='' as $$
 select rule is null or exists(select 1 from public.agent_rules r where r.id=rule and r.company_id=c and public.may_tell_agent_rules(c,r.agent_id,auth.uid()));
$$;
revoke all on function public.can_decide_waiting_rule(uuid,uuid) from public,anon,service_role;
grant execute on function public.can_decide_waiting_rule(uuid,uuid) to authenticated;
alter policy waiting_items_read on public.waiting_items using (person_id=auth.uid() and public.is_member(company_id)
 and public.can_see_conversation_agent(company_id,conversation_id) and public.can_decide_waiting_rule(company_id,agent_rule_id));

-- A save_rule or suggest_rule call of a completed run, carried out by whoever closes it, as before. The role the
-- Conversation's person holds now decides the reach, whichever tool the model called: an Owner's or a Manager's rule is
-- the team's at once; a Contributor's is a suggestion, sent to each Owner and Manager who sees the Agent.
create or replace function public.agent_save_rule(conversation uuid, run text, call text, rule text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; said text:=btrim(rule,E' \t\r\n'); kept public.agent_rules; asked text;
begin
 select * into kept from public.agent_rules r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 if not found then
  select * into talk from public.conversations where id=conversation;
  if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run) then
   return jsonb_build_object('state','refused'); end if;
  if public.may_suggest_agent_rules(talk.company_id,talk.agent_id,talk.person_id) then asked:='pending';
  elsif not public.may_tell_agent_rules(talk.company_id,talk.agent_id,talk.person_id) then return jsonb_build_object('state','refused'); end if;
  if coalesce(length(said) between 1 and 500,false) is not true then return jsonb_build_object('state','invalid'); end if;
  -- A lasting rule is the person's whole message of that run (#18).
  if not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run
   and public.rule_words(m.body)=public.rule_words(said)) then
   return jsonb_build_object('state','refused');
  end if;
  insert into public.agent_rules(company_id,agent_id,body,said_by,conversation_id,run_id,call_id,suggestion)
   values(talk.company_id,talk.agent_id,said,talk.person_id,conversation,run,call,asked)
   on conflict (conversation_id,run_id,call_id) do nothing returning * into kept;
  if kept.id is null then
   select * into kept from public.agent_rules r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
  else
   insert into public.waiting_items(company_id,person_id,kind,title,body,asked_by,agent_rule_id)
    select talk.company_id,m.person_id,'rule_suggestion',left(said,300),coalesce((select a.name from public.hermes_agents a where a.id=talk.agent_id),''),
     left(coalesce((select p.name from public.people p where p.id=talk.person_id),''),120),kept.id
    from public.members m where asked is not null and m.company_id=talk.company_id and public.may_tell_agent_rules(talk.company_id,talk.agent_id,m.person_id);
   insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
    values(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),talk.agent_id,
     case when asked is null then 'AGENT_RULE_SAVED' else 'AGENT_RULE_SUGGESTED' end,
     jsonb_build_object('rule',said,'rule_id',kept.id,'conversation_id',conversation)||case when asked is null then '{}'::jsonb else jsonb_build_object('private',true,'teller',talk.person_id) end);
  end if;
 end if;
 return jsonb_build_object('state',case when kept.suggestion is null then 'saved' else 'suggested' end,'rule',kept.id);
end $$;

-- An Owner or a Manager decides a learning suggestion once, from their own item in "Waiting on you". Approved, it is the
-- team's; refused, it stays in its teller's own runs. The same answer again answers the same and logs nothing more.
create function public.decide_agent_rule(c uuid, item bigint, approve boolean) returns text language plpgsql security definer set search_path='' as $$
declare kept public.agent_rules; wanted text:=case when approve then 'approved' when not approve then 'rejected' end;
begin
 if wanted is null then raise exception 'agentRuleDecisionMissing' using errcode='22023'; end if;
 select r.* into kept from public.waiting_items i join public.agent_rules r on r.id=i.agent_rule_id and r.company_id=i.company_id
  where i.id=item and i.company_id=c and i.person_id=auth.uid() and i.kind='rule_suggestion' and r.agent_id is not null and r.suggestion is not null and r.removed_at is null
  for update of r;
 if not found or not public.can_see_agent(c,kept.agent_id) then raise exception 'agentRuleNotFound' using errcode='P0002'; end if;
 if not public.may_tell_agent_rules(c,kept.agent_id,auth.uid()) then raise exception 'agentRuleNotAllowed' using errcode='42501'; end if;
 if kept.suggestion=wanted then return wanted; end if;
 if kept.suggestion<>'pending' then raise exception 'agentRuleDecided' using errcode='22023'; end if;
 update public.agent_rules set suggestion=wanted,decided_by=auth.uid(),decided_at=now() where id=kept.id;
 update public.waiting_items set resolved_at=now() where agent_rule_id=kept.id and resolved_at is null;
 insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
  values(c,auth.uid(),(select name from public.people where id=auth.uid()),kept.agent_id,case when approve then 'AGENT_RULE_APPROVED' else 'AGENT_RULE_REJECTED' end,
   jsonb_build_object('rule',kept.body,'rule_id',kept.id,'taught_by',(select name from public.people where id=kept.said_by))
    ||case when approve then '{}'::jsonb else jsonb_build_object('private',true,'teller',kept.said_by) end);
 return wanted;
end $$;
revoke all on function public.decide_agent_rule(uuid,bigint,boolean) from public,anon,service_role;
grant execute on function public.decide_agent_rule(uuid,bigint,boolean) to authenticated;

-- Removing a suggestion still waiting takes it off every list too.
create or replace function public.remove_agent_rule(c uuid, rule uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare kept public.agent_rules;
begin
 select * into kept from public.agent_rules r where r.id=rule and r.company_id=c and r.agent_id is not null for update;
 if not found or not public.can_see_agent(c,kept.agent_id) then raise exception 'agentRuleNotFound' using errcode='P0002'; end if;
 if not public.may_tell_agent_rules(c,kept.agent_id,auth.uid()) then raise exception 'agentRuleNotAllowed' using errcode='42501'; end if;
 if kept.removed_at is not null then return false; end if;
 update public.agent_rules set removed_at=now(),removed_by=auth.uid() where id=rule;
 update public.waiting_items set resolved_at=now() where agent_rule_id=rule and resolved_at is null;
 insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
  values(c,auth.uid(),(select name from public.people where id=auth.uid()),kept.agent_id,'AGENT_RULE_REMOVED',jsonb_build_object('rule',kept.body,'rule_id',rule)
   ||case when kept.suggestion in ('pending','rejected') then jsonb_build_object('private',true,'teller',kept.said_by) else '{}'::jsonb end);
 return true;
end $$;

-- The line in the teller's own Conversation names who the suggestion was sent to: the people it waited on, the Owner
-- first.
create function public.rule_suggestions_sent_to(conversation uuid) returns table(rule uuid, sent_to text[]) language sql stable security definer set search_path='' as $$
 select r.id,array_agg(p.name order by m.role='owner' desc,p.name,p.id)
  from public.conversations v join public.agent_rules r on r.conversation_id=v.id and r.suggestion is not null
  join public.waiting_items i on i.agent_rule_id=r.id join public.people p on p.id=i.person_id
  left join public.members m on m.company_id=i.company_id and m.person_id=i.person_id
  where v.id=conversation and v.person_id=auth.uid() and public.can_see_agent(v.company_id,v.agent_id)
  group by r.id;
$$;
revoke all on function public.rule_suggestions_sent_to(uuid) from public,anon,service_role;
grant execute on function public.rule_suggestions_sent_to(uuid) to authenticated;

-- A rule that is not the team's stays with its teller and the Company's Owners and Managers in the log too: its
-- suggestion, its refusal, and its removal while waiting or refused carry `private` and their teller. Its approval, and
-- every event of a team rule, is for everyone who sees the Agent, naming who taught it (log_agent_action reads
-- AGENT_RULE_SUGGESTED, AGENT_RULE_APPROVED and AGENT_RULE_REJECTED as agent_rule_suggested, agent_rule_approved and
-- agent_rule_rejected).
alter policy hermes_agent_audit_read on public.hermes_agent_audit using (public.is_member(company_id) and public.can_see_agent(company_id,agent_id)
 and (details->>'private' is null or actor_id=auth.uid() or details->>'teller'=auth.uid()::text or public.can_manage_company(company_id)));
alter policy company_log_read on public.company_log using (public.is_member(company_id) and public.can_see_agent(company_id,agent_id) and public.can_see_agent(company_id,actor_id)
 and (details->>'private' is null or actor_id=auth.uid() or details->>'teller'=auth.uid()::text or public.can_manage_company(company_id)));
create or replace function public.log_agent_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),coalesce(new.actor_name,(select name from public.people where id=new.actor_id)),
   'agent',new.agent_id,public.log_agent_action(new.action),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=new.agent_id),'replacement_id',new.details->'replacement_id','job',new.details->'job','rule',new.details->'rule','taught_by',new.details->'taught_by','private',new.details->'private','teller',new.details->'teller')),
   'hermes_agent_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
