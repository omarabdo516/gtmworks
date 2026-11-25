select json_build_object(
 'roles',(select string_agg(e.enumlabel,',' order by e.enumsortorder) from pg_enum e where e.enumtypid='public.member_role'::regtype)='owner,manager,contributor,viewer',
 'no_reviewer_type',to_regtype('public.member_role_with_reviewer') is null,
 -- Approval steps went with the Card cutover (#684): a review is decided by an Owner or a Manager, never a reviewer role.
 'approvers_owner_manager',to_regclass('public.approval_steps') is null
  and position('reviewer' in pg_get_functiondef(to_regprocedure('public.decide_review(uuid,bigint,bigint,text,text)')))=0,
 'role_checks_kept',exists(select 1 from pg_constraint where conrelid='public.members'::regclass and conname='members_agent_role_check')
  and exists(select 1 from pg_constraint where conrelid='public.role_permissions'::regclass and conname='no_contributor_viewer_approval'),
 'approval_step_saving_gone',to_regprocedure('public.save_approval_step(uuid,bigint,text,integer,uuid,public.member_role)') is null,
 'no_agency_functions',to_regprocedure('public.agency_access()') is null and to_regprocedure('public.is_agency_owner()') is null,
 'no_agency_flag',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='people' and column_name='agency_owner'),
 'no_agency_policy',not exists(select 1 from pg_policies where concat(qual,' ',with_check) ~ '(agency_access|is_agency_owner|agency_owner)' or policyname in ('company_agency_read','member_agency_read')),
 'no_agency_function_body',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc ~ '(agency_access|is_agency_owner|agency_owner)'),
 -- The Connections these check were dropped with #342 (20270213000000); a replay of this migration puts them back.
 'connection_owner',case when to_regclass('public.hermes_connections') is null then true else
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='hermes_connections' and column_name='owner_id')
  and not has_column_privilege('authenticated','public.hermes_connections','owner_id','update') end,
 'connection_key_company_scope',case when to_regclass('public.hermes_connections') is null then true else has_column_privilege('service_role','public.hermes_connections','company_id','select') end,
 'connection_destination_fixed',case when to_regclass('public.hermes_connections') is null then true else
  exists(select 1 from pg_trigger where tgrelid=to_regclass('public.hermes_connections') and tgname='hermes_retarget_refused' and tgenabled='O' and tgfoid=to_regprocedure('public.keep_hermes_destination()')) end,
 'owner_check',has_function_privilege('authenticated','public.is_company_owner(uuid)','execute') and not has_function_privilege('anon','public.is_company_owner(uuid)','execute'),
 'role_policies_restored',(select count(*) from pg_policies where schemaname='public' and policyname in ('invitation_insert','invitation_update'))=2
);
