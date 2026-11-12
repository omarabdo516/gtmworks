select json_build_object(
 'agents_rls',(select relrowsecurity from pg_class where oid='public.hermes_agents'::regclass),
 'audit_rls',(select relrowsecurity from pg_class where oid='public.hermes_agent_audit'::regclass),
 'one_default',to_regclass('public.hermes_one_default') is not null,
 'checked_mutations',not has_table_privilege('authenticated','public.hermes_agents','insert') and has_function_privilege('authenticated','public.manage_hermes_agent(uuid,text,uuid,uuid,text,text,boolean,boolean,uuid)','execute')
);
