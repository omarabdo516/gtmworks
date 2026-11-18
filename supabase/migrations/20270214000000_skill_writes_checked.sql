-- Review of spec #340 (decision 0042): a skill written into an Agent's profile in the Engine is followed in every Run on
-- that profile, so who may write one and the log of each change stay in gtmworks, as for the Company knowledge
-- (20270209000000). check_skill_write checks a write or a switch before the Engine is changed: an active Owner or Manager
-- of the Company, an Agent of that Company, and no text that looks like a secret. log_skill_change records it once the
-- Engine holds it, as one row of the Company log on the Agent. The names of the shared Skills are refused in the app
-- (lib/company-skills.mjs).
--
-- A Contributor's run is offered suggest_team_rule in place of suggest_rule, whose pinned text says the rule reaches its
-- teller at once, which is no longer so (20270210000000); a run pinned with suggest_rule keeps it. The previous app
-- version sends no suggest_team_rule text, so a Contributor's run it starts during an update is offered no rule tool.
--
-- Dropped, unused by this app version and the previous one: record_conversation_run and record_conversation_reply,
-- which let an Owner set a conversation's Hermes session, now the pointer its steps and token use are read from. Only
-- the worker's close_conversation_run sets it. Nothing is rewritten; the previous app version calls neither.

create function public.check_skill_write(c uuid, agent uuid, body text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_manage_company(c) or not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c)
  then raise exception 'skillNotAllowed' using errcode='42501'; end if;
 if public.secret_like(body) then raise exception 'skillSecret' using errcode='22023'; end if;
end $$;
revoke all on function public.check_skill_write(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.check_skill_write(uuid,uuid,text) to authenticated;

-- The Agent log line keeps a skill's name too (from 20270213000000's body).
create or replace function public.log_agent_event(c uuid, actor uuid, actor_name text, agent uuid, act text, details jsonb)
 returns void language sql security definer set search_path='' as $$
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,actor,public.log_actor_kind(c,actor),coalesce(actor_name,(select name from public.people where id=actor)),
   'agent',agent,public.log_agent_action(act),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=agent),'replacement_id',details->'replacement_id','job',details->'job','rule',details->'rule','taught_by',details->'taught_by','asked_for',details->'asked_for','asked_by',details->'asked_by','reason',details->'reason','private',details->'private','teller',details->'teller','skill',details->'skill')),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
$$;
revoke all on function public.log_agent_event(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated,service_role;

-- A skill written, switched on or switched off for one Agent, logged as the signed-in Owner or Manager.
create function public.log_skill_change(c uuid, agent uuid, skill text, act text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_skill_write(c,agent,null);
 if skill is null or skill !~ '^[a-z0-9][a-z0-9_-]{0,63}$' or act is null or act not in ('written','enabled','disabled')
  then raise exception 'skillInvalid' using errcode='22023'; end if;
 perform public.log_agent_event(c,auth.uid(),null,agent,'skill_'||act,jsonb_build_object('skill',skill));
end $$;
revoke all on function public.log_skill_change(uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.log_skill_change(uuid,uuid,text,text) to authenticated;

drop function if exists public.record_conversation_run(uuid,text,text,text,text,bigint,bigint);
drop function if exists public.record_conversation_reply(uuid,text,text,text);

-- 20270201000000's run_tools, with suggest_team_rule in suggest_rule's slot.
create or replace function public.run_tools(c uuid, agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[
  case when public.may_use_lead_tools(c,agent,person) then 'create_agent' when public.may_ask_lead_for_agents(c,agent,person) then 'request_agent' end,
  case when public.may_tell_agent_rules(c,agent,person) then 'save_rule' when public.may_suggest_agent_rules(c,agent,person) then 'suggest_team_rule' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_draft' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_review' end,
  case when public.may_show_reply_cards(c,agent,person) then 'hand_over' end,
  case when public.may_show_reply_cards(c,agent,person) then 'ask_for_app' end],null);
$$;
