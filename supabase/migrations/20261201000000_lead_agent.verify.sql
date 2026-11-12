select json_build_object(
 'bundled_agent_is_lead',pg_get_functiondef('public.provide_bundled_hermes(text,text,text,text,text[])'::regprocedure) like '%values(target,linked,''Lead'',''General'',true)%',
 'no_default_named_engine',not exists(select 1 from public.hermes_agents where is_default and lower(trim(name))='hermes'),
 'service_only',has_function_privilege('service_role','public.provide_bundled_hermes(text,text,text,text,text[])','execute') and not has_function_privilege('authenticated','public.provide_bundled_hermes(text,text,text,text,text[])','execute') and not has_function_privilege('anon','public.provide_bundled_hermes(text,text,text,text,text[])','execute')
);
