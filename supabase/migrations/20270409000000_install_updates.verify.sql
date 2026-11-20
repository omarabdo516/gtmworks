-- #443: the update row exists, no role of the app reaches it but through its two functions, and those take Owners only.
select json_build_object(
 'one_row',(select count(*)=1 from public.install_updates),
 'button_on_auto_off',(select button and not auto from public.install_updates),
 'row_level_security',(select relrowsecurity from pg_class where oid='public.install_updates'::regclass),
 'no_role_reaches_the_table',not has_table_privilege('authenticated','public.install_updates','select,insert,update,delete')
  and not has_table_privilege('anon','public.install_updates','select,insert,update,delete')
  and not has_table_privilege('service_role','public.install_updates','select,insert,update,delete'),
 'functions_for_signed_in_only',has_function_privilege('authenticated','public.install_update()','execute')
  and has_function_privilege('authenticated','public.request_install_update()','execute')
  and not has_function_privilege('anon','public.request_install_update()','execute')
  and not has_function_privilege('service_role','public.request_install_update()','execute')
);
