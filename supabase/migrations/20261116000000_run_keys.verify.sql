-- The run keys this migration made were dropped with the external-agent API (#341, 20270206000000_remove_external_agent_api),
-- and revoking a role agent's access went with the role agents (spec #695, 20270418000001_legacy_role_agents_cutover).
select json_build_object('dropped_by_20270206', to_regclass('public.agent_keys') is null and to_regprocedure('public.issue_run_key(uuid,bigint,text,integer)') is null
 and to_regprocedure('public.revoke_agent_access(uuid,uuid)') is null);
