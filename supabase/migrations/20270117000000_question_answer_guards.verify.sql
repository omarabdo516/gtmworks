-- answer_question and track_run_question keep their grants, and a Run's end closes its questions.
select json_build_object(
 'answer_by_person_only',has_function_privilege('authenticated','public.answer_question(uuid,uuid,bigint,integer,text,uuid,integer[])','execute')
  and not has_function_privilege('anon','public.answer_question(uuid,uuid,bigint,integer,text,uuid,integer[])','execute')
  and not has_function_privilege('service_role','public.answer_question(uuid,uuid,bigint,integer,text,uuid,integer[])','execute'),
 'tracked_by_worker_only',has_function_privilege('service_role','public.track_run_question(uuid,text,jsonb,boolean,timestamptz)','execute')
  and not has_function_privilege('authenticated','public.track_run_question(uuid,text,jsonb,boolean,timestamptz)','execute'),
 'run_end_closes_questions',exists(select 1 from pg_trigger where tgname='conversation_run_ends_closes_questions' and tgrelid='public.conversation_run_ends'::regclass)
);
