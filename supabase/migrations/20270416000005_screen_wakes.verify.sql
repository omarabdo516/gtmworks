-- #712: the check and the log row of a Screen a person woke.
select json_build_object(
 'only_people_check',has_function_privilege('authenticated','public.check_screen_wake(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.check_screen_wake(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.check_screen_wake(uuid,uuid)','execute'),
 'only_people_log',has_function_privilege('authenticated','public.log_screen_woken(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.log_screen_woken(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.log_screen_woken(uuid,uuid)','execute'),
 'log_checks_first',position('check_screen_wake' in pg_get_functiondef('public.log_screen_woken(uuid,uuid)'::regprocedure))>0
);
