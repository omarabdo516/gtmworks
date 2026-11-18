select json_build_object(
 'lessons_rls',(select relrowsecurity from pg_class where oid='public.skill_lessons'::regclass),
 'clients_cannot_write_lessons',not has_table_privilege('authenticated','public.skill_lessons','insert') and not has_table_privilege('authenticated','public.skill_lessons','update') and not has_table_privilege('authenticated','public.skill_lessons','delete') and not has_table_privilege('anon','public.skill_lessons','select'),
 'lesson_functions_for_signed_in_people',has_function_privilege('authenticated','public.decide_skill_lesson(uuid,bigint,boolean)','execute') and not has_function_privilege('anon','public.decide_skill_lesson(uuid,bigint,boolean)','execute'),
 'one_proposal_per_request_key',exists(select 1 from pg_constraint where conrelid='public.skill_lessons'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (company_id, proposed_by, request_key)'),
 'decisions_need_a_manager',position('can_manage_company' in pg_get_functiondef('public.decide_skill_lesson(uuid,bigint,boolean)'::regprocedure))>0
);
