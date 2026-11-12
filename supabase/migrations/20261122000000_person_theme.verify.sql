select json_build_object(
 'theme_nullable_default', (select is_nullable='YES' and column_default is null from information_schema.columns where table_schema='public' and table_name='people' and column_name='theme'),
 'people_rls', (select relrowsecurity from pg_class where oid='public.people'::regclass),
 'authenticated_can_set_theme', has_function_privilege('authenticated','public.set_theme(text)','EXECUTE'),
 'anonymous_cannot_set_theme', not has_function_privilege('anon','public.set_theme(text)','EXECUTE'),
 'theme_function_scoped', (select proconfig = array['search_path=""']::text[] and prosecdef from pg_proc where oid='public.set_theme(text)'::regprocedure));
