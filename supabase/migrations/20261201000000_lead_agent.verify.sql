select json_build_object(
 'bundled_agent_is_lead',pg_get_functiondef('public.attach_company_profile(uuid)'::regprocedure) like '%''Lead'',''General'',true)%',
 'no_default_named_engine',not exists(select 1 from public.hermes_agents where is_default and lower(trim(name))='hermes'),
 'service_only',has_function_privilege('service_role','public.attach_company_profile(uuid)','execute') and not has_function_privilege('authenticated','public.attach_company_profile(uuid)','execute') and not has_function_privilege('anon','public.attach_company_profile(uuid)','execute')
);
