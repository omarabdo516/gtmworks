-- #915: the install owner's row is reached by no role of the app, and a signed-in person only asks whether they are it.
select json_build_object(
 'row_level_security',(select relrowsecurity from pg_class where oid='public.install_owner'::regclass),
 'no_role_reaches_the_table',not has_table_privilege('authenticated','public.install_owner','select,insert,update,delete')
  and not has_table_privilege('anon','public.install_owner','select,insert,update,delete')
  and not has_table_privilege('service_role','public.install_owner','select,insert,update,delete'),
 'signed_in_only_ask',has_function_privilege('authenticated','public.is_install_owner()','execute')
  and not has_function_privilege('anon','public.is_install_owner()','execute')
  and not has_function_privilege('service_role','public.is_install_owner()','execute'),
 'first_run_records_it',position('install_owner' in pg_get_functiondef('public.complete_setup(uuid,text,text,text)'::regprocedure))>0
);
