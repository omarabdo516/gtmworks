-- An idea is a Card made from the Ideas column with new_card (#683), which names its assignee, Agent or Member; the
-- create_work_card overloads went with the Card cutover (#684). The Card's log row is written as an idea.
select json_build_object(
 'agent_overload',to_regprocedure('public.create_work_card(uuid,bigint,text,uuid)') is null and to_regprocedure('public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)') is not null,
 'old_signature_kept',to_regprocedure('public.create_work_card(uuid,bigint,text,text,text)') is null,
 'members_may_add',has_function_privilege('authenticated','public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)','execute'),
 'anon_may_not_add',not has_function_privilege('anon','public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)','execute'),
 'idea_logged',position('''idea_added''' in pg_get_functiondef('public.work_audit()'::regprocedure))>0,
 'projects_still_logged',position('''project_id''' in pg_get_functiondef('public.work_audit()'::regprocedure))>0
);
