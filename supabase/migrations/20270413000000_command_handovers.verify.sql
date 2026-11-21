-- #358: a handover row says whether its target answers the person, and the four functions that move a Run or a leg know
-- it, so a command's handover is no Run of the chat's Agent, never reaches a follow-up leg, and keeps the target's reply
-- as the chat's message.
select json_build_object(
 'answers_person_column',(select count(*)=1 and bool_and(attnotnull and not attisdropped) from pg_attribute
  where attrelid='public.agent_handovers'::regclass and attname='answers_person'),
 'answers_person_default_false',(select pg_get_expr(adbin,adrelid)='false' from pg_attrdef
  where adrelid='public.agent_handovers'::regclass
   and adnum=(select attnum from pg_attribute where attrelid='public.agent_handovers'::regclass and attname='answers_person')),
 'start_waited_at_column',exists(select 1 from pg_attribute where attrelid='public.agent_handovers'::regclass and attname='start_waited_at' and not attisdropped),
 'session_held_until_column',exists(select 1 from pg_attribute where attrelid='public.agent_handovers'::regclass and attname='session_held_until' and not attisdropped),
 'begin_handover_holds_a_lost_start',position('session_held_until' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))>0,
 'person_reads_answers_person',has_column_privilege('authenticated','public.agent_handovers','answers_person','select'),
 'command_handover_writes_for_a_member',has_function_privilege('authenticated','public.command_handover(uuid,uuid,uuid,uuid,text,text,text)','execute'),
 'command_handover_kept_from_the_worker',not has_function_privilege('service_role','public.command_handover(uuid,uuid,uuid,uuid,text,text,text)','execute')
  and not has_function_privilege('anon','public.command_handover(uuid,uuid,uuid,uuid,text,text,text)','execute'),
 'open_run_skips_the_command',position('answers_person' in pg_get_functiondef('public.conversation_open_run(uuid)'::regprocedure))>0,
 'worker_list_skips_the_command',position('answers_person' in pg_get_functiondef('public.open_conversation_runs(uuid,uuid,bigint)'::regprocedure))>0
  and has_function_privilege('service_role','public.open_conversation_runs(uuid,uuid,bigint)','execute')
  and not has_function_privilege('authenticated','public.open_conversation_runs(uuid,uuid,bigint)','execute'),
 'begin_handover_knows_it',position('answers_person' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))>0,
 'close_target_knows_it',position('answers_person' in pg_get_functiondef('public.close_handover_target(bigint,text,text,text)'::regprocedure))>0,
 'agent_move_skips_the_command',position('answers_person' in pg_get_functiondef('public.agent_move_blocked(uuid)'::regprocedure))>0,
 'company_move_skips_the_command',position('answers_person' in pg_get_functiondef('public.move_company_profile(uuid)'::regprocedure))>0
);
