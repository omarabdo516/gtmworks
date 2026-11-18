-- A skill change is checked and logged by the database, and no Member sets a conversation's Hermes session.
select json_build_object(
 'check_for_members',has_function_privilege('authenticated','public.check_skill_write(uuid,uuid,text)','execute'),
 'log_for_members',has_function_privilege('authenticated','public.log_skill_change(uuid,uuid,text,text)','execute'),
 'log_writer_private',not has_function_privilege('authenticated','public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)','execute'),
 'run_recorder_gone',to_regprocedure('public.record_conversation_run(uuid,text,text,text,text,bigint,bigint)') is null,
 'contributors_offered_new_suggestion',position('''suggest_team_rule''' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))>0
  and position('''suggest_rule''' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))=0,
 'reply_recorder_gone',to_regprocedure('public.record_conversation_reply(uuid,text,text,text)') is null
);
