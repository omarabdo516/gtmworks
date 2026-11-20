-- #457: a Run's end may name a model error a retry cannot fix, and the closer takes each.
select json_build_object(
 'outcome_takes_no_credit',exists(select 1 from pg_constraint where conname='conversation_run_ends_outcome_check'
  and conrelid='public.conversation_run_ends'::regclass and pg_get_constraintdef(oid) like '%no_credit%'),
 'outcome_takes_key_refused',exists(select 1 from pg_constraint where conname='conversation_run_ends_outcome_check'
  and conrelid='public.conversation_run_ends'::regclass and pg_get_constraintdef(oid) like '%key_refused%'),
 'outcome_takes_model_missing',exists(select 1 from pg_constraint where conname='conversation_run_ends_outcome_check'
  and conrelid='public.conversation_run_ends'::regclass and pg_get_constraintdef(oid) like '%model_missing%'),
 'old_outcome_check_gone',not exists(select 1 from pg_constraint where conname='conversation_usage_outcome_check'
  and conrelid='public.conversation_run_ends'::regclass),
 'closer_takes_no_credit',position('''no_credit''' in
  pg_get_functiondef('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)'::regprocedure))>0,
 'closer_takes_key_refused',position('''key_refused''' in
  pg_get_functiondef('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)'::regprocedure))>0,
 'closer_takes_model_missing',position('''model_missing''' in
  pg_get_functiondef('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)'::regprocedure))>0,
 'closer_still_service_only',has_function_privilege('service_role','public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)','execute')
  and not has_function_privilege('authenticated','public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)','execute')
);
