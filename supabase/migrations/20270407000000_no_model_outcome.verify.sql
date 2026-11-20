-- #422: a Run's end may be no_model, and the closer takes it.
select json_build_object(
 'outcome_takes_no_model',exists(select 1 from pg_constraint where conname='conversation_run_ends_outcome_check'
  and conrelid='public.conversation_run_ends'::regclass and pg_get_constraintdef(oid) like '%no_model%'),
 'old_outcome_check_gone',not exists(select 1 from pg_constraint where conname='conversation_usage_outcome_check'
  and conrelid='public.conversation_run_ends'::regclass),
 'closer_takes_no_model',position('''no_model''' in
  pg_get_functiondef('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)'::regprocedure))>0,
 'closer_still_service_only',has_function_privilege('service_role','public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)','execute')
  and not has_function_privilege('authenticated','public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)','execute')
);
