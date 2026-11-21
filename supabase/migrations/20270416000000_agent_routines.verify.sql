-- #31: a Routine is changed by an Owner or a Manager, checked before the Engine is asked, and each change is one row of
-- the Company log naming the Routine; the log writer stays private.
select json_build_object(
 'check_for_members',has_function_privilege('authenticated','public.check_routine_change(uuid,uuid,text,text,text)','execute')
  and not has_function_privilege('anon','public.check_routine_change(uuid,uuid,text,text,text)','execute'),
 'log_for_members',has_function_privilege('authenticated','public.log_routine_change(uuid,uuid,text,text,text,uuid)','execute')
  and not has_function_privilege('anon','public.log_routine_change(uuid,uuid,text,text,text,uuid)','execute'),
 'managers_checked',position('can_manage_company' in pg_get_functiondef('public.check_routine_change(uuid,uuid,text,text,text)'::regprocedure))>0,
 'log_writer_private',not has_function_privilege('authenticated','public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)','execute'),
 'routine_kept',position('''routine''' in pg_get_functiondef('public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)'::regprocedure))>0
  and position('''setting''' in pg_get_functiondef('public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)'::regprocedure))>0
);
