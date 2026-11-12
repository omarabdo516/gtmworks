select json_build_object(
 'agents_rls',(select relrowsecurity from pg_class where oid='public.agents'::regclass),
 'grants_rls',(select relrowsecurity from pg_class where oid='public.agent_grants'::regclass),
 'grant_row_per_company_and_agent',exists(select 1 from pg_constraint where conrelid='public.agent_grants'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (company_id, agent_id)'),
 'revocation_records_who',exists(select 1 from pg_constraint where conrelid='public.agent_grants'::regclass and conname='agent_grants_revocation'),
 'key_lookup_needs_grant',position('agent_grants' in pg_get_functiondef('public.lookup_agent_key(text)'::regprocedure))>0,
 'membership_needs_grant',exists(select 1 from pg_trigger where tgrelid='public.members'::regclass and tgname='agent_membership_guard' and not tgisinternal),
 'owner_functions_for_signed_in_people',has_function_privilege('authenticated','public.grant_agent_access(uuid,uuid)','execute') and has_function_privilege('authenticated','public.revoke_agent_access(uuid,uuid)','execute') and not has_function_privilege('anon','public.grant_agent_access(uuid,uuid)','execute') and not has_function_privilege('anon','public.revoke_agent_access(uuid,uuid)','execute'),
 'denied_lookup_for_server_only',has_function_privilege('service_role','public.agent_key_denied(text)','execute') and not has_function_privilege('authenticated','public.agent_key_denied(text)','execute') and not has_function_privilege('anon','public.agent_key_denied(text)','execute'),
 'clients_cannot_write_grants',not has_table_privilege('authenticated','public.agent_grants','insert') and not has_table_privilege('authenticated','public.agent_grants','update') and not has_table_privilege('authenticated','public.agent_grants','delete')
);
