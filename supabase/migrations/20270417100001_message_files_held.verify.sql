-- #727: waiting rows record the attempts that hold them; a reserve that names its attempt holds them, every discard takes
-- only rows no attempt holds, and the overload that names its attempt takes itself off first, with the reserves' grants.
select json_build_object(
 'rows_record_their_holders',exists(select 1 from information_schema.columns where table_schema='public' and table_name='conversation_attachments' and column_name='attempts')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='channel_attachments' and column_name='attempts'),
 'a_reserve_holds_the_rows',position('array_append(a.attempts,attempt)' in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb,uuid)'::regprocedure))>0
  and position('array_append(a.attempts,attempt)' in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb,uuid)'::regprocedure))>0,
 'a_discard_takes_only_unheld_rows',position('cardinality(a.attempts)=0' in pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid)'::regprocedure))>0
  and position('cardinality(a.attempts)=0' in pg_get_functiondef('public.discard_channel_files(uuid,uuid,uuid)'::regprocedure))>0
  and position('cardinality(a.attempts)=0' in pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid,uuid)'::regprocedure))>0
  and position('cardinality(a.attempts)=0' in pg_get_functiondef('public.discard_channel_files(uuid,uuid,uuid,uuid)'::regprocedure))>0,
 'a_discard_lets_go_of_its_attempt',position('array_remove(a.attempts,attempt)' in pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid,uuid)'::regprocedure))>0
  and position('array_remove(a.attempts,attempt)' in pg_get_functiondef('public.discard_channel_files(uuid,uuid,uuid,uuid)'::regprocedure))>0,
 'held_turns_still_keep_their_files',position('conversation_queued_turns' in pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid,uuid)'::regprocedure))>0,
 'same_grants',has_function_privilege('authenticated','public.discard_conversation_files(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.discard_conversation_files(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.discard_conversation_files(uuid,uuid,uuid,uuid)','execute')
  and has_function_privilege('authenticated','public.discard_channel_files(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.discard_channel_files(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.discard_channel_files(uuid,uuid,uuid,uuid)','execute')
);
