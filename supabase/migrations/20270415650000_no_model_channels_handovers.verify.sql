-- #428: a channel Run and a handover's legs may end no_model, their closers take it, and a channel's handovers say so.
select json_build_object(
 'channel_runs_take_no_model',exists(select 1 from pg_constraint where conname='channel_runs_outcome_check'
  and conrelid='public.channel_runs'::regclass and pg_get_constraintdef(oid) like '%no_model%'),
 'handover_legs_take_no_model',(select count(*)=2 from pg_constraint where conname in ('agent_handovers_target_outcome','agent_handovers_follow_up_outcome')
  and conrelid='public.agent_handovers'::regclass and pg_get_constraintdef(oid) like '%no_model%'),
 'closers_take_no_model',(select bool_and(position('''no_model''' in pg_get_functiondef(f::regprocedure))>0)
  from unnest(array['public.close_channel_run(bigint,text,text,text,bigint,bigint)','public.close_handover_target(bigint,text,text,text)',
   'public.close_handover_follow_up(bigint,text,text,text)']) f),
 'closers_still_service_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute'))
  from unnest(array['public.close_channel_run(bigint,text,text,text,bigint,bigint)','public.close_handover_target(bigint,text,text,text)',
   'public.close_handover_follow_up(bigint,text,text,text)']) f),
 'channel_handovers_say_no_model',exists(select 1 from pg_proc where oid='public.channel_handovers(uuid)'::regprocedure
  and 'no_model'=any(proargnames)),
 'channel_handovers_for_members_only',has_function_privilege('authenticated','public.channel_handovers(uuid)','execute')
  and not has_function_privilege('anon','public.channel_handovers(uuid)','execute')
  and not has_function_privilege('service_role','public.channel_handovers(uuid)','execute')
);
