-- #535: the worker alone keeps and reads each Routine result as it ends; no Member reads the kept runs.
select json_build_object(
 'worker_only',has_function_privilege('service_role','public.keep_routine_results(uuid,jsonb)','execute')
  and has_function_privilege('service_role','public.good_morning_night(uuid,timestamptz,timestamptz)','execute')
  and not has_function_privilege('authenticated','public.keep_routine_results(uuid,jsonb)','execute')
  and not has_function_privilege('authenticated','public.routine_results_seen(uuid,text,text[])','execute')
  and not has_function_privilege('authenticated','public.good_morning_night(uuid,timestamptz,timestamptz)','execute'),
 'no_member_reads',not has_table_privilege('authenticated','public.routine_results','select')
  and not has_table_privilege('anon','public.routine_results','select'),
 'one_row_a_run',exists(select 1 from pg_constraint where conrelid='public.routine_results'::regclass and contype='u'),
 'rls',(select relrowsecurity from pg_class where oid='public.routine_results'::regclass)
);
