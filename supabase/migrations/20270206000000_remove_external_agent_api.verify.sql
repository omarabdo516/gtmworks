-- The external-agent API is gone (#341): its tables, functions and webhook triggers; revoking an Agent's access still
-- works for signed-in people only, and the board's «ask an Agent» keeps its idempotent write.
select json_build_object(
 'tables_dropped',(select bool_and(to_regclass('public.'||t) is null) from unnest(array['agent_keys','agent_webhooks','webhook_deliveries','engine_tool_checks']) t),
 'functions_dropped',not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('log_agent_refusal','agent_rate_limit','enqueue_person_webhook',
  'claim_webhook_deliveries','agent_key_denied','lookup_agent_key','issue_run_key_for','issue_run_key','enqueue_assignment_webhook','revoke_run_keys','agent_key_revoked',
  'agent_load_skills','propose_skill_lesson','record_engine_tools','agent_tool_warning')),
 'no_webhook_trigger',not exists(select 1 from pg_trigger where tgname ~ 'webhook' and not tgisinternal),
 'revoke_kept',has_function_privilege('authenticated','public.revoke_agent_access(uuid,uuid)','execute') and not has_function_privilege('anon','public.revoke_agent_access(uuid,uuid)','execute')
  and position('agent_keys' in pg_get_functiondef('public.revoke_agent_access(uuid,uuid)'::regprocedure))=0,
 'board_write_kept',to_regprocedure('public.agent_write(uuid,text,text,text,bigint,jsonb)') is not null and to_regclass('public.agent_requests') is not null
);
