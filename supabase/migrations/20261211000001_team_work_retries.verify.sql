-- A known send key keeps its answer, a run's note is pinned at its first reservation, a turn with an unknown start is
-- claimed again on its own reservation, and quoted or address-borne secrets are refused.
select json_build_object(
 'run_notes_closed',(select relrowsecurity from pg_class where oid='public.conversation_run_notes'::regclass)
  and not has_table_privilege('authenticated','public.conversation_run_notes','select')
  and not has_function_privilege('authenticated','public.pinned_run_note(uuid,uuid,uuid,uuid)','execute'),
 'known_key_first',position('conversation_notes n where n.conversation_id=conversation and n.send_key=message_key' in pg_get_functiondef('public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text)'::regprocedure))
  < position('conversation_addressee' in pg_get_functiondef('public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text)'::regprocedure)),
 'note_pinned',(select bool_and(position('pinned_run_note' in pg_get_functiondef(f::regprocedure))>0)
  from unnest(array['public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text)','public.claim_conversation_turn(uuid)']) f),
 'claim_still_worker_only',has_function_privilege('service_role','public.claim_conversation_turn(uuid)','execute') and not has_function_privilege('authenticated','public.claim_conversation_turn(uuid)','execute'),
 'quoted_and_address_secrets',public.secret_like('{"password":"hunter22"}') and public.secret_like('postgresql://alice:hunter22@localhost/db')
  and public.secret_like('DB_PASSWORD=hunter22') and not public.secret_like('I never share my password with agents.')
);
