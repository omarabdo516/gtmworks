-- A request moved to the Fallback model (#644): only the worker logs it, once per Run, in the Company's log as gtmworks's
-- own entry naming the two models and nothing else.
select json_build_object(
 'worker_only',has_function_privilege('service_role','public.record_fallback_move(uuid,text,text,text,text,text)','execute')
  and not has_function_privilege('authenticated','public.record_fallback_move(uuid,text,text,text,text,text)','execute')
  and not has_function_privilege('anon','public.record_fallback_move(uuid,text,text,text,text,text)','execute'),
 'as_definer',(select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.record_fallback_move(uuid,text,text,text,text,text)'::regprocedure),
 'once_per_run',exists(select 1 from pg_indexes where schemaname='public' and indexname='company_audit_fallback_run' and indexdef like '%UNIQUE%(company_id, run_id)%'),
 'logged_by_gtmworks',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_values')) like '%fallback_model_used%actor_id IS NULL%',
 'log_copies_the_models',position('fallback_model_used' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0
  and position('to_model' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0,
 'earlier_actions_kept',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_action_check')) like '%provider_switched%fallback_model_used%',
 'worker_reads_the_choice',has_table_privilege('service_role','public.company_fallback_models','select')
  and not has_table_privilege('service_role','public.company_fallback_models','insert')
);
