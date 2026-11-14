-- A Company profile Connection is guarded in both tables, a Run is reserved by the sender's own session only, the move
-- and the message record know the reservations, and nobody reads or writes reservations directly.
select json_build_object(
 'connection_guard',exists(select 1 from pg_trigger where tgrelid='public.hermes_connections'::regclass and tgname='company_profile_connection' and tgenabled='O'),
 'agent_guard',exists(select 1 from pg_trigger where tgrelid='public.hermes_agents'::regclass and tgname='company_profile_agent' and tgenabled='O'),
 'reserve_by_sender',has_function_privilege('authenticated','public.reserve_conversation_run(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.reserve_conversation_run(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.reserve_conversation_run(uuid,uuid,uuid,uuid)','execute'),
 'reserve_checks_level',position('company_profile_ready' in pg_get_functiondef('public.reserve_conversation_run(uuid,uuid,uuid,uuid)'::regprocedure))>0,
 'move_waits',position('conversation_run_reservations' in pg_get_functiondef('public.move_company_profile(uuid,text,text,text,text[])'::regprocedure))>0,
 'record_ends_reservation',position('conversation_run_reservations' in pg_get_functiondef('public.send_conversation_message(uuid,uuid,uuid,text,uuid,text)'::regprocedure))>0,
 'reservations_closed',(select relrowsecurity from pg_class where oid='public.conversation_run_reservations'::regclass)
  and not has_table_privilege('authenticated','public.conversation_run_reservations','select') and not has_table_privilege('service_role','public.conversation_run_reservations','insert')
);
