-- #413: a start that never reached an Engine is handed back by the worker alone; no person may call either function.
select json_build_object(
 'channel_release',to_regprocedure('public.release_channel_start(bigint,integer,smallint)') is not null
  and has_function_privilege('service_role','public.release_channel_start(bigint,integer,smallint)','execute')
  and not has_function_privilege('authenticated','public.release_channel_start(bigint,integer,smallint)','execute')
  and not has_function_privilege('anon','public.release_channel_start(bigint,integer,smallint)','execute'),
 'note_release',to_regprocedure('public.release_note_start(bigint,integer)') is not null
  and has_function_privilege('service_role','public.release_note_start(bigint,integer)','execute')
  and not has_function_privilege('authenticated','public.release_note_start(bigint,integer)','execute')
  and not has_function_privilege('anon','public.release_note_start(bigint,integer)','execute'),
 'only_the_begun_attempt',position('is distinct from attempt' in pg_get_functiondef('public.release_channel_start(bigint,integer,smallint)'::regprocedure))>0
  and position('is distinct from attempt' in pg_get_functiondef('public.release_note_start(bigint,integer)'::regprocedure))>0
)
