-- Only a signed-in person reaches the three app functions, each runs as its owner with an empty search path and checks
-- the Owner itself; the sign-ins are read by the Company's Owners only and written by nobody directly; connects and
-- disconnects reach the Company's log beside renames and level changes.
select json_build_object(
 'signed_in_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.start_app_sign_in(uuid,text,text)','public.finish_app_sign_in(text,text)','public.record_app_disconnected(uuid,text)']) f),
 'run_as_owner',(select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.start_app_sign_in(uuid,text,text)'::regprocedure,'public.finish_app_sign_in(text,text)'::regprocedure,'public.record_app_disconnected(uuid,text)'::regprocedure)),
 'check_the_owner',(select bool_and(position('is_company_owner' in pg_get_functiondef(f::regprocedure))>0)
  from unnest(array['public.start_app_sign_in(uuid,text,text)','public.finish_app_sign_in(text,text)','public.record_app_disconnected(uuid,text)']) f),
 'finish_own_only',position('started_by=auth.uid()' in pg_get_functiondef('public.finish_app_sign_in(text,text)'::regprocedure))>0,
 'sign_ins_closed',(select relrowsecurity from pg_class where oid='public.company_app_sign_ins'::regclass)
  and has_table_privilege('authenticated','public.company_app_sign_ins','select')
  and not has_table_privilege('authenticated','public.company_app_sign_ins','insert') and not has_table_privilege('authenticated','public.company_app_sign_ins','update')
  and not has_table_privilege('authenticated','public.company_app_sign_ins','delete') and not has_table_privilege('service_role','public.company_app_sign_ins','insert')
  and not has_table_privilege('anon','public.company_app_sign_ins','select'),
 'owners_read',(select bool_and(cmd='SELECT' and position('is_company_owner' in qual)>0) from pg_policies where schemaname='public' and tablename='company_app_sign_ins'),
 'apps_logged',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_action_check')) like '%app_connected%app_disconnected%'
  and position('app_connected' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0
  and position('agent_level_changed' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0
);
