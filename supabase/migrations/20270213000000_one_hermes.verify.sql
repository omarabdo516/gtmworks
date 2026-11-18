-- One Hermes (#342): no Connection table, no Agent audit table and no function that reads either; every Agent names
-- its profile, and the Agent log line still reaches the company log.
select json_build_object(
 'connections_gone',to_regclass('public.hermes_connections') is null,
 'audit_gone',to_regclass('public.hermes_agent_audit') is null,
 'no_function_names_them',not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace
  and (p.prosrc ~ '\m(hermes_connections|is_bundled_connection)\M' or p.prosrc ~ 'public\.hermes_agent_audit')),
 'agent_profile_kept',exists(select 1 from information_schema.columns where table_schema='public' and table_name='hermes_agents' and column_name='profile' and is_nullable='NO'),
 'log_writer_private',not has_function_privilege('authenticated','public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)','execute')
);
