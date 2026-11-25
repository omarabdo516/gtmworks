-- #727: waiting rows record the attempts that hold them; a reserve that names its attempt holds them, the discard that
-- names its attempt takes itself off first and takes only rows no live hold keeps, the previous version's discards are
-- unchanged, and the new discards have the reserves' grants.
select json_build_object(
 'rows_record_their_holders',(select count(*) from information_schema.columns where table_schema='public'
   and table_name in ('conversation_attachments','channel_attachments') and column_name in ('holders','held_at'))=4,
 'a_reserve_holds_the_rows',position('array_append(a.holders,attempt)' in pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb,uuid)'::regprocedure))>0
  and position('array_append(a.holders,attempt)' in pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb,uuid)'::regprocedure))>0,
 'a_discard_lets_go_of_its_attempt',position('array_remove(a.holders,attempt)' in pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid,uuid)'::regprocedure))>0
  and position('array_remove(a.holders,attempt)' in pg_get_functiondef('public.discard_channel_files(uuid,uuid,uuid,uuid)'::regprocedure))>0,
 'a_discard_takes_only_rows_no_live_hold_keeps',position('cardinality(a.holders)=0' in pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid,uuid)'::regprocedure))>0
  and position('cardinality(a.holders)=0' in pg_get_functiondef('public.discard_channel_files(uuid,uuid,uuid,uuid)'::regprocedure))>0,
 'the_previous_discards_are_unchanged',position('holders' in pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid)'::regprocedure))=0
  and position('holders' in pg_get_functiondef('public.discard_channel_files(uuid,uuid,uuid)'::regprocedure))=0,
 'a_waiting_turn_still_keeps_its_files',position('conversation_queued_turns' in pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid,uuid)'::regprocedure))>0,
 'same_grants',has_function_privilege('authenticated','public.discard_conversation_files(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.discard_conversation_files(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.discard_conversation_files(uuid,uuid,uuid,uuid)','execute')
  and has_function_privilege('authenticated','public.discard_channel_files(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.discard_channel_files(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.discard_channel_files(uuid,uuid,uuid,uuid)','execute')
);
