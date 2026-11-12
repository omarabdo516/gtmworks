select json_build_object(
 'setup_rls',(select relrowsecurity from pg_class where oid='public.setup_claim'::regclass),
 'setup_singleton',(select count(*)=1 from public.setup_claim),
 'setup_private',not has_table_privilege('anon','public.setup_claim','select') and not has_table_privilege('authenticated','public.setup_claim','update'),
 'setup_functions_private',not has_function_privilege('anon','public.setup_is_open()','execute') and not has_function_privilege('authenticated','public.setup_is_open()','execute') and not has_function_privilege('anon','public.complete_setup(uuid,text,text,text)','execute') and not has_function_privilege('authenticated','public.complete_setup(uuid,text,text,text)','execute'),
 'service_can_setup',has_function_privilege('service_role','public.setup_is_open()','execute') and has_function_privilege('service_role','public.complete_setup(uuid,text,text,text)','execute'),
 'setup_functions_scoped',(select bool_and(prosecdef and proconfig=array['search_path=""']::text[]) from pg_proc where oid in ('public.setup_is_open()'::regprocedure,'public.complete_setup(uuid,text,text,text)'::regprocedure))
);
