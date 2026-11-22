-- #622: the Company's Fallback model is read by its Members, written only through the Owner's function and listed for
-- the worker alone; every Run's end, its closers and a channel's handovers take `no_access`.
select json_build_object(
 'rls',(select relrowsecurity from pg_class where oid='public.company_fallback_models'::regclass),
 'members_read',has_table_privilege('authenticated','public.company_fallback_models','select')
  and not has_table_privilege('authenticated','public.company_fallback_models','insert')
  and not has_table_privilege('authenticated','public.company_fallback_models','update')
  and not has_table_privilege('authenticated','public.company_fallback_models','delete')
  and not has_table_privilege('anon','public.company_fallback_models','select'),
 'owner_function',has_function_privilege('authenticated','public.set_company_fallback_model(uuid,text,text)','execute')
  and not has_function_privilege('anon','public.set_company_fallback_model(uuid,text,text)','execute'),
 'worker_only',has_function_privilege('service_role','public.fallback_model_work()','execute')
  and not has_function_privilege('authenticated','public.fallback_model_work()','execute'),
 'ends_take_no_access',(select count(*)=5 from pg_constraint where conname in ('conversation_run_ends_outcome_check','channel_runs_outcome_check',
  'agent_handovers_target_outcome','agent_handovers_follow_up_outcome','note_runs_outcome_check') and pg_get_constraintdef(oid) like '%no_access%'),
 'closers_take_no_access',(select bool_and(position('''no_access''' in pg_get_functiondef(f::regprocedure))>0)
  from unnest(array['public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)',
   'public.close_channel_run(bigint,text,text,text,bigint,bigint)','public.close_handover_target(bigint,text,text,text)',
   'public.close_handover_follow_up(bigint,text,text,text)','public.close_handover_answer(bigint,text,text,text)',
   'public.close_note_run(bigint,text,text,text,bigint,bigint)','public.channel_handovers(uuid)']) f),
 'closers_still_service_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute'))
  from unnest(array['public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)',
   'public.close_channel_run(bigint,text,text,text,bigint,bigint)','public.close_note_run(bigint,text,text,text,bigint,bigint)']) f)
);
