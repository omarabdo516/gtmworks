select json_build_object(
 'roles',(select string_agg(e.enumlabel,',' order by e.enumsortorder) from pg_enum e where e.enumtypid='public.member_role'::regtype)='owner,manager,contributor,viewer',
 'no_reviewer_type',to_regtype('public.member_role_with_reviewer') is null,
 'approvers_owner_manager',exists(select 1 from pg_constraint where conrelid='public.approval_steps'::regclass and conname='approval_steps_approver_role')
  and not exists(select 1 from pg_constraint where conrelid='public.approval_steps'::regclass and contype='c' and pg_get_constraintdef(oid) like '%reviewer%')
  and position('reviewer' in pg_get_functiondef('public.approval_holds(uuid,bigint)'::regprocedure))=0
  and position('reviewer' in pg_get_functiondef('public.approval_actor(uuid,bigint)'::regprocedure))=0,
 'role_checks_kept',exists(select 1 from pg_constraint where conrelid='public.members'::regclass and conname='members_agent_role_check')
  and exists(select 1 from pg_constraint where conrelid='public.role_permissions'::regclass and conname='no_contributor_viewer_approval'),
 'approval_step_saving',has_function_privilege('authenticated','public.save_approval_step(uuid,bigint,text,integer,uuid,public.member_role)','execute')
  and not has_function_privilege('anon','public.save_approval_step(uuid,bigint,text,integer,uuid,public.member_role)','execute'),
 'no_agency_functions',to_regprocedure('public.agency_access()') is null and to_regprocedure('public.is_agency_owner()') is null,
 'no_agency_flag',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='people' and column_name='agency_owner'),
 'no_agency_policy',not exists(select 1 from pg_policies where concat(qual,' ',with_check) ~ '(agency_access|is_agency_owner|agency_owner)' or policyname in ('company_agency_read','member_agency_read')),
 'no_agency_function_body',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc ~ '(agency_access|is_agency_owner|agency_owner)'),
 'connection_owner',exists(select 1 from information_schema.columns where table_schema='public' and table_name='hermes_connections' and column_name='owner_id')
  and not has_column_privilege('authenticated','public.hermes_connections','owner_id','update'),
 'connection_destination_fixed',exists(select 1 from pg_trigger where tgrelid='public.hermes_connections'::regclass and tgname='hermes_retarget_refused' and tgenabled='O' and tgfoid=to_regprocedure('public.keep_hermes_destination()')),
 'owner_check',has_function_privilege('authenticated','public.is_company_owner(uuid)','execute') and not has_function_privilege('anon','public.is_company_owner(uuid)','execute'),
 'role_policies_restored',(select count(*) from pg_policies where schemaname='public' and policyname in ('agent_keys_owner_read','agent_keys_owner_create','agent_keys_owner_update','agent_refusals_owner_read','agent_webhooks_owner','webhook_deliveries_owner_read','invitation_insert','invitation_update'))=8
);
