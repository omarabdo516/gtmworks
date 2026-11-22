-- #530: a channel Run, a handover's legs and a Card note's Run may end with a model cause a retry cannot fix, their
-- closers take it, and a channel's handovers say which one and whose leg it was.
select json_build_object(
 'channel_runs_take_refusals',exists(select 1 from pg_constraint where conname='channel_runs_outcome_check'
  and conrelid='public.channel_runs'::regclass and pg_get_constraintdef(oid) like '%model_missing%'),
 'handover_legs_take_refusals',(select count(*)=2 from pg_constraint where conname in ('agent_handovers_target_outcome','agent_handovers_follow_up_outcome')
  and conrelid='public.agent_handovers'::regclass and pg_get_constraintdef(oid) like '%no_credit%'),
 'note_runs_take_no_model_and_refusals',exists(select 1 from pg_constraint where conname='note_runs_outcome_check'
  and conrelid='public.note_runs'::regclass and pg_get_constraintdef(oid) like '%no_model%' and pg_get_constraintdef(oid) like '%key_refused%'),
 'closers_take_refusals',(select bool_and(position('''key_refused''' in pg_get_functiondef(f::regprocedure))>0)
  from unnest(array['public.close_channel_run(bigint,text,text,text,bigint,bigint)','public.close_handover_target(bigint,text,text,text)',
   'public.close_handover_follow_up(bigint,text,text,text)','public.close_handover_answer(bigint,text,text,text)',
   'public.close_note_run(bigint,text,text,text,bigint,bigint)']) f),
 'closers_still_service_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute'))
  from unnest(array['public.close_channel_run(bigint,text,text,text,bigint,bigint)','public.close_handover_target(bigint,text,text,text)',
   'public.close_handover_follow_up(bigint,text,text,text)','public.close_handover_answer(bigint,text,text,text)',
   'public.close_note_run(bigint,text,text,text,bigint,bigint)']) f),
 'channel_handovers_say_the_cause',exists(select 1 from pg_proc where oid='public.channel_handovers(uuid)'::regprocedure
  and 'model_end'=any(proargnames) and 'model_agent'=any(proargnames) and 'no_model'=any(proargnames)),
 'channel_handovers_for_members_only',has_function_privilege('authenticated','public.channel_handovers(uuid)','execute')
  and not has_function_privilege('anon','public.channel_handovers(uuid)','execute')
  and not has_function_privilege('service_role','public.channel_handovers(uuid)','execute')
);
