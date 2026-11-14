-- Only a signed-in person may call the rename, it runs as its owner with an empty search path, and it checks the
-- Owner itself; companies still have no update policy of their own. Every rename is kept and copied into the log,
-- and nobody but the rename writes the record.
select json_build_object(
 'signed_in_only',has_function_privilege('authenticated','public.rename_company(uuid,text)','execute')
  and not has_function_privilege('anon','public.rename_company(uuid,text)','execute')
  and not has_function_privilege('service_role','public.rename_company(uuid,text)','execute'),
 'runs_as_owner',(select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.rename_company(uuid,text)'::regprocedure),
 'checks_the_owner',position('is_company_owner' in pg_get_functiondef('public.rename_company(uuid,text)'::regprocedure))>0,
 'no_update_policy',not exists(select 1 from pg_policies where schemaname='public' and tablename='companies' and cmd in ('UPDATE','ALL')),
 'audit_rls',(select relrowsecurity from pg_class where oid='public.company_audit'::regclass),
 'audit_written_by_rename_only',not has_table_privilege('authenticated','public.company_audit','insert') and not has_table_privilege('authenticated','public.company_audit','select')
  and not has_table_privilege('service_role','public.company_audit','insert'),
 'rename_copied_to_log',exists(select 1 from pg_trigger where tgrelid='public.company_audit'::regclass and tgname='company_audit_company_log' and tgenabled='O'),
 'log_takes_company_rows',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_log'::regclass and conname='company_log_subject_check')) like '%company%'
  and pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_log'::regclass and conname='company_log_source_check')) like '%company_audit%'
);
