-- #465: a send's images are given back only once no queued turn or Run reservation of its key may still need them, and
-- the function keeps the signature and grants the previous app version calls. The worker reads a waiting turn's files.
select json_build_object(
 'held_by_a_waiting_turn',position('conversation_queued_turns' in pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid)'::regprocedure))>0,
 'held_by_a_reservation',position('conversation_run_reservations' in pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid)'::regprocedure))>0,
 'same_grants',has_function_privilege('authenticated','public.discard_conversation_files(uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.discard_conversation_files(uuid,uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.discard_conversation_files(uuid,uuid,uuid)','execute'),
 'the_worker_reads_a_waiting_turns_files',has_table_privilege('service_role','public.conversation_attachments','select')
  and not has_table_privilege('service_role','public.conversation_attachments','insert,update,delete')
);
