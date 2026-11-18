begin;
create extension if not exists pgtap with schema extensions;
select plan(21);
-- #341: the external-agent API (ADR 0006, 0007) is gone: its keys, webhooks, deliveries and the
-- Engine tool checks, with every function and trigger that served them.
select hasnt_table('public','agent_keys','agent keys are dropped');
select hasnt_table('public','agent_webhooks','agent webhooks are dropped');
select hasnt_table('public','webhook_deliveries','webhook deliveries are dropped');
select hasnt_table('public','engine_tool_checks','engine tool checks are dropped');
select hasnt_function('public',f,f||' is dropped') from unnest(array['log_agent_refusal','agent_rate_limit','enqueue_person_webhook',
 'claim_webhook_deliveries','agent_key_denied','lookup_agent_key','issue_run_key_for','issue_run_key','enqueue_assignment_webhook',
 'revoke_run_keys','agent_key_revoked','agent_load_skills','propose_skill_lesson','record_engine_tools','agent_tool_warning']) f;
select is((select count(*)::int from pg_trigger where tgname ~ 'webhook' and not tgisinternal),0,'no webhook trigger is left');
select is((select count(*)::int from pg_proc where pronamespace='public'::regnamespace and prosrc ~ '\m(agent_keys|agent_webhooks|webhook_deliveries|engine_tool_checks)\M'),0,'no function reads or writes a dropped table');
select * from finish();
rollback;
