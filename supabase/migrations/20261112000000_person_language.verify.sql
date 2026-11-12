select json_build_object(
 'language_default', (select column_default = '''en''::text' and is_nullable='NO' from information_schema.columns where table_schema='public' and table_name='people' and column_name='language'),
 'people_rls', (select relrowsecurity from pg_class where oid='public.people'::regclass),
 'authenticated_can_set_language', has_function_privilege('authenticated','public.set_language(text)','EXECUTE'),
 'anonymous_cannot_set_language', not has_function_privilege('anon','public.set_language(text)','EXECUTE'),
 'language_function_scoped', (select proconfig = array['search_path=""']::text[] and prosecdef from pg_proc where oid='public.set_language(text)'::regprocedure));
