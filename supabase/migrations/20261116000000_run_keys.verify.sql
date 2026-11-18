-- The run keys this migration made were dropped with the external-agent API (#341, 20270206000000_remove_external_agent_api);
-- revoking an Agent's access no longer ends any.
select json_build_object('dropped_by_20270206', to_regclass('public.agent_keys') is null and to_regprocedure('public.issue_run_key(uuid,bigint,text,integer)') is null
 and position('agent_keys' in pg_get_functiondef('public.revoke_agent_access(uuid,uuid)'::regprocedure))=0);
