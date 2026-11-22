-- The Engine's moves to another account (#621): only the worker copies them, each once, into the Company's log as
-- gtmworks's own entry, with the provider, the two accounts and their names and nothing else.
select json_build_object(
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute')
  and not has_function_privilege('anon',f,'execute')) from unnest(array['public.record_provider_switches(uuid,jsonb)','public.provider_accounts_work()']) f),
 'as_definer',(select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.record_provider_switches(uuid,jsonb)'::regprocedure,'public.provider_accounts_work()'::regprocedure)),
 'copied_once',exists(select 1 from pg_indexes where schemaname='public' and indexname='company_audit_switch' and indexdef like '%UNIQUE%(company_id, switch_id)%'),
 'logged_by_gtmworks',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_values')) like '%provider_switched%actor_id IS NULL%',
 'log_copies_the_names',position('provider_switched' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0
  and position('from_name' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0,
 'earlier_actions_kept',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_action_check')) like '%provider_key_removed%provider_switched%'
);
