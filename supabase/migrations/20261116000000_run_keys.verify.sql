select json_build_object(
 'run_key_columns',(select count(*)=4 from information_schema.columns where table_schema='public' and table_name='agent_keys' and column_name in ('kind','card_id','expires_at','issued_at')),
 'only_a_hash_is_stored',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_keys' and column_name in ('key','secret','token','plaintext')),
 'run_key_names_a_card_and_expires',exists(select 1 from pg_constraint where conrelid='public.agent_keys'::regclass and conname='agent_keys_scope'),
 'run_key_card_in_same_company',exists(select 1 from pg_constraint where conrelid='public.agent_keys'::regclass and conname='agent_keys_card_fk'),
 'lookup_skips_expired_keys',position('expires_at' in pg_get_functiondef('public.lookup_agent_key(text)'::regprocedure))>0,
 'lookup_for_server_only',has_function_privilege('service_role','public.lookup_agent_key(text)','execute') and not has_function_privilege('authenticated','public.lookup_agent_key(text)','execute') and not has_function_privilege('anon','public.lookup_agent_key(text)','execute'),
 'issue_for_signed_in_agents',has_function_privilege('authenticated','public.issue_run_key(uuid,bigint,text,integer)','execute') and not has_function_privilege('anon','public.issue_run_key(uuid,bigint,text,integer)','execute'),
 'revoking_a_grant_revokes_run_keys',position('agent_keys' in pg_get_functiondef('public.revoke_agent_access(uuid,uuid)'::regprocedure))>0,
 'assignment_queues_a_run_key_delivery',exists(select 1 from pg_trigger where tgrelid='public.work_assignees'::regclass and tgname='enqueue_assignment_webhook' and not tgisinternal) and exists(select 1 from pg_trigger where tgrelid='public.work_cards'::regclass and tgname='enqueue_assignment_webhook_actor' and not tgisinternal),
 'only_the_worker_issues_for_an_agent',has_function_privilege('service_role','public.issue_run_key_for(uuid,bigint,uuid,text,integer)','execute') and not has_function_privilege('authenticated','public.issue_run_key_for(uuid,bigint,uuid,text,integer)','execute'),
 'holder_can_revoke_run_keys',has_function_privilege('authenticated','public.revoke_run_keys(uuid,bigint,uuid)','execute') and not has_function_privilege('anon','public.revoke_run_keys(uuid,bigint,uuid)','execute'),
 'owner_revoke_ends_run_keys',exists(select 1 from pg_trigger where tgrelid='public.agent_keys'::regclass and tgname='agent_key_revoked' and not tgisinternal),
 'writes_fenced_to_the_run_card',position('run_card' in pg_get_functiondef('public.agent_write(uuid,text,text,text,bigint,jsonb)'::regprocedure))>0,
 'owners_see_company_keys_only',(select bool_and(position('kind' in coalesce(pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)))>0) from pg_policy where polrelid='public.agent_keys'::regclass)
);
