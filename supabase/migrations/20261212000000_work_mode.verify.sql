-- A first-run Company waits for its Owner's answer; only a signed-in person may give it, and the table holds only
-- alone or team.
select json_build_object(
 'setup_leaves_it_unanswered',pg_get_functiondef('public.complete_setup(uuid,text,text,text)'::regprocedure) ~ 'companies\(id,slug,name,work_mode(,engine_id)?\) values\(company,slug,company_name,null(,engine)?\)',
 'answered_by_people_only',has_function_privilege('authenticated','public.choose_work_mode(uuid,text)','execute')
  and not has_function_privilege('anon','public.choose_work_mode(uuid,text)','execute'),
 'two_answers_only',exists(select 1 from pg_constraint where conrelid='public.companies'::regclass and contype='c' and pg_get_constraintdef(oid) like '%work_mode%alone%team%')
);
