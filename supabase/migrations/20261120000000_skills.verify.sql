select json_build_object(
 'skills_rls',(select bool_and(relrowsecurity) from pg_class where oid in ('public.skills'::regclass,'public.skill_versions'::regclass,'public.skill_enablements'::regclass,'public.skill_events'::regclass,'public.skill_loads'::regclass)),
 'clients_cannot_write',not has_table_privilege('authenticated','public.skills','insert') and not has_table_privilege('authenticated','public.skill_versions','insert') and not has_table_privilege('authenticated','public.skill_enablements','insert') and not has_table_privilege('authenticated','public.skill_loads','insert') and not has_table_privilege('authenticated','public.skill_events','insert'),
 'one_slug_per_company',exists(select 1 from pg_constraint where conrelid='public.skills'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (company_id, slug)'),
 'versioned_content',exists(select 1 from pg_constraint where conrelid='public.skill_versions'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (skill_id, version)'),
 'functions_for_signed_in_people',has_function_privilege('authenticated','public.install_skill(uuid,text,text)','execute') and has_function_privilege('authenticated','public.set_skill_enabled(uuid,uuid,uuid,boolean)','execute') and not has_function_privilege('anon','public.install_skill(uuid,text,text)','execute'),
 'agents_list_for_signed_in_people',has_function_privilege('authenticated','public.skill_agents(uuid)','execute') and not has_function_privilege('anon','public.skill_agents(uuid)','execute'),
 'check_not_callable_by_clients',not has_function_privilege('authenticated','public.skill_parse(text)','execute')
);
