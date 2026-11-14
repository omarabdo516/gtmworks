-- The sender alone abandons a reservation whose run never started, under the move's lock, and only an active one.
select json_build_object(
 'release_by_sender',has_function_privilege('authenticated','public.release_conversation_run(uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.release_conversation_run(uuid,uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.release_conversation_run(uuid,uuid,uuid)','execute'),
 'release_takes_the_move_lock',position('hashtextextended(''hermes_agents'',0)' in pg_get_functiondef('public.release_conversation_run(uuid,uuid,uuid)'::regprocedure))>0,
 'release_only_own_active',position('auth.uid()' in pg_get_functiondef('public.release_conversation_run(uuid,uuid,uuid)'::regprocedure))>0
  and position('abandoned_at is null' in pg_get_functiondef('public.release_conversation_run(uuid,uuid,uuid)'::regprocedure))>0
);
