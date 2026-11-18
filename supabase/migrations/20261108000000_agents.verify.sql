-- The agent keys and the webhook queue this migration made were dropped with the external-agent API (#341,
-- 20270206000000_remove_external_agent_api).
select json_build_object('dropped_by_20270206', to_regclass('public.agent_keys') is null and to_regclass('public.webhook_deliveries') is null);
