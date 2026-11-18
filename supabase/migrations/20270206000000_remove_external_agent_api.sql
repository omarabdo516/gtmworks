-- #341 (spec #340, decision 0042): the external-agent API of ADR 0006 and 0007 goes. Hermes ships inside the install
-- (ADR 0010) and nothing calls the `v1` routes or receives a webhook any more, so the agent keys, run keys, the
-- webhook settings and deliveries, and the Engine tool checks are dropped with every
-- function and trigger that served them. No data is copied (decision 0042). Rolling back to v0.1.0 finds them missing
-- (Omar accepted this).
--
-- Kept (not on the ticket's list; decision pending with Omar): agent_rate_limits and agent_refusals, now unused.
-- Kept: agent_write, which the board's «ask an Agent» still calls (its run-key line never matches without a run key),
-- and agent_requests, its idempotency record; agent_key_waits, which holds an Agent for a provider key (#299), not an
-- agent key; engine_tools_due and the worker's check that remakes a lost profile; engine_tool_policy.

-- Triggers first: they fire on kept tables (work_activity, work_assignees, work_cards).
drop trigger if exists enqueue_person_webhook on public.work_activity;
drop trigger if exists enqueue_assignment_webhook on public.work_assignees;
drop trigger if exists enqueue_assignment_webhook_actor on public.work_cards;
drop trigger if exists enqueue_assignment_webhook_new on public.work_cards;

drop function if exists public.enqueue_person_webhook();
drop function if exists public.enqueue_assignment_webhook();
drop function if exists public.claim_webhook_deliveries();
drop function if exists public.log_agent_refusal(uuid,uuid,text);
drop function if exists public.agent_rate_limit(uuid);
drop function if exists public.agent_key_denied(text);
drop function if exists public.lookup_agent_key(text);
drop function if exists public.issue_run_key_for(uuid,bigint,uuid,text,integer);
drop function if exists public.issue_run_key(uuid,bigint,text,integer);
drop function if exists public.revoke_run_keys(uuid,bigint,uuid);
drop function if exists public.agent_load_skills(uuid,uuid);
drop function if exists public.propose_skill_lesson(uuid,uuid,text,text,text,text,text);
drop function if exists public.record_engine_tools(uuid,text[]);
drop function if exists public.agent_tool_warning(uuid);

-- Revoking an Agent's access no longer ends its run keys: there are none. The rest of the body is unchanged.
create or replace function public.revoke_agent_access(c uuid, a uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare found_agent public.agents%rowtype; begin
 if auth.uid() is null or not public.can_assign_owner(c) then raise exception 'not permitted to revoke agent access' using errcode='42501'; end if;
 update public.agent_grants set revoked_at=now(), revoked_by=auth.uid() where company_id=c and agent_id=a and revoked_at is null;
 if not found then raise exception 'grant not found'; end if;
 update public.members set removed_at=now() where company_id=c and person_id=a and removed_at is null;
 select * into found_agent from public.agents where id=a;
 insert into public.member_audit(company_id,actor_id,actor_name,person_id,person_name,action,before_data) values (c,auth.uid(),(select name from public.people where id=auth.uid()),a,(select name from public.people where id=a),'REVOKE_AGENT',jsonb_build_object('agent_role',found_agent.role));
end $function$;

-- `cascade` drops only these tables' own policies, triggers and constraints, and the foreign keys other tables hold to
-- them (skill_loads.key_id, which the skills ticket #343 drops with its table).
drop table if exists public.webhook_deliveries cascade;
drop table if exists public.agent_webhooks cascade;
drop table if exists public.agent_keys cascade;
drop table if exists public.engine_tool_checks cascade;

drop function if exists public.agent_key_revoked();
