select json_build_object(
 'projects_table_with_status',exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_projects' and column_name='status'),
 'projects_rls',(select relrowsecurity from pg_class where oid='public.work_projects'::regclass),
 'card_and_project_share_a_company',exists(select 1 from pg_constraint where conname='work_cards_project_fk' and contype='f' and conrelid='public.work_cards'::regclass and confrelid='public.work_projects'::regclass),
 'signed_in_people_only',has_table_privilege('authenticated','public.work_projects','select') and not has_table_privilege('anon','public.work_projects','select'),
 'project_never_changes_company',not has_column_privilege('authenticated','public.work_projects','company_id','update'),
 'filing_goes_through_edit',position('project_id' in pg_get_functiondef('public.edit_work_card(uuid,bigint,jsonb,text)'::regprocedure))>0,
 'filing_is_in_the_activity',position('project_id' in pg_get_functiondef('public.work_audit()'::regprocedure))>0
);
