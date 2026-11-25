-- #713: the check and the two log rows of control of a Screen.
select json_build_object(
 'only_people',bool_and(has_function_privilege('authenticated',fn,'execute') and not has_function_privilege('anon',fn,'execute')
  and not has_function_privilege('service_role',fn,'execute')),
 'take_checks_first',position('check_screen_wake' in pg_get_functiondef('public.log_screen_taken(uuid,uuid)'::regprocedure))>0,
 'give_back_checks_the_agent',position('can_see_agent' in pg_get_functiondef('public.log_screen_given_back(uuid,uuid)'::regprocedure))>0
) from unnest(array['public.check_screen_control(uuid,uuid)','public.log_screen_taken(uuid,uuid)','public.log_screen_given_back(uuid,uuid)']) fn;
