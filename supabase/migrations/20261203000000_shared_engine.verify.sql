select json_build_object(
 'owner_asks',has_function_privilege('authenticated','public.bundled_engine_shared(uuid)','execute') and not has_function_privilege('anon','public.bundled_engine_shared(uuid)','execute'),
 'owner_only',position('''owner''' in pg_get_functiondef('public.bundled_engine_shared(uuid)'::regprocedure))>0
);
