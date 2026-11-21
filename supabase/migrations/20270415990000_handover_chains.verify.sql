-- #477: an asked Agent hands on. A handover keeps its parent; the asked Agent's job no longer forbids memory, routines or
-- handing on, and says to put any need from the person in its reply; its leg waits for its children and answers in a
-- Run of its own; the worker alone starts it with its targets, pins its tool and keeps its calls; the Conversation names each
-- row's parent.
select json_build_object(
 'a_handover_keeps_its_parent',exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_handovers' and column_name='parent_id' and is_nullable='YES'),
 'the_asked_agent_has_its_tools',position('do not hand the job on' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))=0
  and position('Do not save anything to memory' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))=0
  and position('in your reply, and' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))>0,
 'a_leg_waits_for_its_children',position('c.parent_id=h and c.state not in (''done'',''failed'')' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))>0
  and position('state=''handing''' in pg_get_functiondef('public.close_handover_target(bigint,text,text,text)'::regprocedure))>0,
 'an_answer_holds_its_profile',position('h.state=''handing'' and h.answer_attempts>0' in pg_get_functiondef('public.agent_move_blocked(uuid)'::regprocedure))>0
  and position('h.state=''handing'' and h.answer_attempts>0' in pg_get_functiondef('public.move_company_profile(uuid)'::regprocedure))>0,
 'the_worker_alone',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.begin_handover(bigint)','public.pin_handover_tools(bigint,text)','public.handover_hand_to_agent(bigint,text,text,text,text,text)','public.close_handover_answer(bigint,text,text,text)']) f),
 'the_conversation_names_the_parent',exists(select 1 from pg_proc p where p.oid='public.conversation_handovers(uuid)'::regprocedure and 'parent'=any(p.proargnames))
  and not has_column_privilege('authenticated','public.agent_handovers','tools','select')
);
