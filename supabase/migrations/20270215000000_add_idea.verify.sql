-- An idea names its Agent in a new create_work_card overload; the previous app version's signature stays, and the
-- Card's log row is written as an idea.
select json_build_object(
 'agent_overload',to_regprocedure('public.create_work_card(uuid,bigint,text,uuid)') is not null,
 'old_signature_kept',to_regprocedure('public.create_work_card(uuid,bigint,text,text,text)') is not null,
 'members_may_add',has_function_privilege('authenticated','public.create_work_card(uuid,bigint,text,uuid)','execute'),
 'anon_may_not_add',not has_function_privilege('anon','public.create_work_card(uuid,bigint,text,uuid)','execute'),
 'idea_logged',position('''idea_added''' in pg_get_functiondef('public.work_audit()'::regprocedure))>0,
 'projects_still_logged',position('''project_id''' in pg_get_functiondef('public.work_audit()'::regprocedure))>0
);
