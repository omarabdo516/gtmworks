-- #598: each keep attempt names its own paths, beside the four-argument functions the previous app version calls, with
-- the same grants.
select json_build_object(
 'a_conversation_attempt_names_its_paths',position($q$message_key::text||'-'||attempt::text||'-'||place::text$q$ in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb,uuid)'::regprocedure))>0,
 'a_channel_attempt_names_its_paths',position($q$message_key::text||'-'||attempt::text||'-'||place::text$q$ in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb,uuid)'::regprocedure))>0,
 'the_previous_paths_stay_for_the_previous_app',position($q$message_key::text||'-'||place::text$q$ in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0
  and position($q$message_key::text||'-'||place::text$q$ in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb)'::regprocedure))>0,
 'held_files_still_answer_held',position('return -2' in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb,uuid)'::regprocedure))>0,
 'same_grants',has_function_privilege('authenticated','public.reserve_conversation_files(uuid,uuid,uuid,jsonb,uuid)','execute')
  and not has_function_privilege('anon','public.reserve_conversation_files(uuid,uuid,uuid,jsonb,uuid)','execute')
  and not has_function_privilege('service_role','public.reserve_conversation_files(uuid,uuid,uuid,jsonb,uuid)','execute')
  and has_function_privilege('authenticated','public.reserve_channel_files(uuid,uuid,uuid,jsonb,uuid)','execute')
  and not has_function_privilege('anon','public.reserve_channel_files(uuid,uuid,uuid,jsonb,uuid)','execute')
  and not has_function_privilege('service_role','public.reserve_channel_files(uuid,uuid,uuid,jsonb,uuid)','execute')
);
