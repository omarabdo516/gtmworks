-- A Conversation keeps a checked model choice, only the Owner's own session sets it, and only the worker pins and refuses
-- a Run's model.
select json_build_object(
 'choice_checked',exists(select 1 from pg_constraint where conname='conversations_model_valid' and conrelid='public.conversations'::regclass)
  and (select bool_and(not has_function_privilege(r,'public.model_choice_valid(jsonb)','execute')) from unnest(array['anon','authenticated','service_role']) r),
 'owner_sets',has_function_privilege('authenticated','public.set_conversation_model(uuid,uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.set_conversation_model(uuid,uuid,jsonb)','execute')
  and not has_function_privilege('service_role','public.set_conversation_model(uuid,uuid,jsonb)','execute')
  and position('is_company_owner(c)' in pg_get_functiondef('public.set_conversation_model(uuid,uuid,jsonb)'::regprocedure))>0,
 'worker_pins',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.pin_run_model(uuid,uuid)','public.refuse_run_model(uuid,uuid)']) f),
 'pin_private',not has_column_privilege('authenticated','public.conversation_run_notes','model','select')
);
