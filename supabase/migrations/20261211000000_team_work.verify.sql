-- Team work: the sender's one entry point, the worker-only queue functions, stop for the run's person or a manager,
-- member notes readable by their own Member only and refused when too long or secret-looking.
select json_build_object(
 'turn_by_sender',has_function_privilege('authenticated','public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('service_role','public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text)','execute'),
 'queue_worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.queued_conversations(uuid)','public.claim_conversation_turn(uuid)','public.record_conversation_turn(uuid,uuid,text,uuid)','public.fail_conversation_turn(uuid,uuid)']) f),
 'internal_helpers_closed',(select bool_and(not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.conversation_addressee(uuid,text)','public.conversation_open_run(uuid)','public.conversation_busy(uuid,uuid)']) f),
 'stop_checked_by_role',position('can_manage_company' in pg_get_functiondef('public.conversation_stop_target(uuid,uuid)'::regprocedure))>0
  and has_function_privilege('authenticated','public.conversation_stop_target(uuid,uuid)','execute'),
 'turn_takes_the_conversation_lock',(select bool_and(position('conversation_turn:' in pg_get_functiondef(f::regprocedure))>0)
  from unnest(array['public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text)','public.claim_conversation_turn(uuid)']) f),
 'record_takes_the_move_lock',position('hashtextextended(''hermes_agents'',0)' in pg_get_functiondef('public.record_conversation_turn(uuid,uuid,text,uuid)'::regprocedure))>0,
 'tables_have_rls',(select bool_and(relrowsecurity) from pg_class where oid in ('public.member_notes'::regclass,'public.conversation_queued_turns'::regclass,'public.conversation_notes'::regclass)),
 'notes_append_only',exists(select 1 from pg_trigger where tgrelid='public.conversation_notes'::regclass and tgname='conversation_notes_append_only' and tgenabled='O'),
 'member_note_checks',exists(select 1 from pg_constraint where conname='member_note_length' and conrelid='public.member_notes'::regclass)
  and exists(select 1 from pg_constraint where conname='member_note_no_secret' and conrelid='public.member_notes'::regclass),
 'member_note_own_only',exists(select 1 from pg_policies where tablename='member_notes' and policyname='member_notes_own' and qual like '%auth.uid()%' and with_check like '%auth.uid()%'),
 'secret_patterns',public.secret_like('password: hunter22') and public.secret_like('الباسورد: 12345678') and public.secret_like('sk-abcdefghijklmnopqrstuvwxyz0123') and not public.secret_like('Answer in short points, in Egyptian Arabic.'),
 'queue_not_writable_by_members',not has_table_privilege('authenticated','public.conversation_queued_turns','insert')
  and not has_table_privilege('authenticated','public.conversation_notes','insert'),
 'previous_version_kept',to_regprocedure('public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)') is not null
  and to_regprocedure('public.send_conversation_message(uuid,uuid,uuid,text,uuid,text)') is not null
);
