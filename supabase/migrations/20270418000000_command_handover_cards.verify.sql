-- #470: a job command's Agent asks and acts in the chat through the command's own Run, and Lead's brief carries the
-- chat's command jobs and their answers.
select json_build_object(
 'question_tracked_for_the_worker',has_function_privilege('service_role','public.track_handover_question(bigint,text,jsonb,boolean,timestamptz)','execute')
  and not has_function_privilege('authenticated','public.track_handover_question(bigint,text,jsonb,boolean,timestamptz)','execute')
  and not has_function_privilege('anon','public.track_handover_question(bigint,text,jsonb,boolean,timestamptz)','execute'),
 'permission_tracked_for_the_worker',has_function_privilege('service_role','public.track_handover_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz)','execute')
  and not has_function_privilege('authenticated','public.track_handover_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz)','execute')
  and not has_function_privilege('anon','public.track_handover_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz)','execute'),
 'command_agent_may_ask',position('ask them' in pg_get_functiondef('public.command_handover_job(bigint)'::regprocedure))>0
  and has_function_privilege('service_role','public.command_handover_job(bigint)','execute')
  and not has_function_privilege('authenticated','public.command_handover_job(bigint)','execute'),
 'lead_brief_carries_commands',position('''commands''' in pg_get_functiondef('public.pin_lead_brief(uuid,uuid)'::regprocedure))>0
  and has_function_privilege('service_role','public.pin_lead_brief(uuid,uuid)','execute')
);
