-- #379: each Run these lists names the Company whose Engine reads and closes it, and the grants stay the worker's.
select json_build_object(
 'open_conversation_runs', position('company uuid' in pg_get_function_result('public.open_conversation_runs(uuid,uuid,bigint)'::regprocedure))>0
  and position('c.company_id' in pg_get_functiondef('public.open_conversation_runs(uuid,uuid,bigint)'::regprocedure))>0
  and not has_function_privilege('authenticated','public.open_conversation_runs(uuid,uuid,bigint)','execute')
  and has_function_privilege('service_role','public.open_conversation_runs(uuid,uuid,bigint)','execute'),
 'channel_runs_due', position('company uuid' in pg_get_function_result('public.channel_runs_due(uuid,bigint,bigint)'::regprocedure))>0
  and position('r.company_id' in pg_get_functiondef('public.channel_runs_due(uuid,bigint,bigint)'::regprocedure))>0
  and has_function_privilege('service_role','public.channel_runs_due(uuid,bigint,bigint)','execute')
  and not has_function_privilege('authenticated','public.channel_runs_due(uuid,bigint,bigint)','execute'),
 'note_runs_due', position('company uuid' in pg_get_function_result('public.note_runs_due(bigint,bigint)'::regprocedure))>0
  and position('r.company_id' in pg_get_functiondef('public.note_runs_due(bigint,bigint)'::regprocedure))>0
  and has_function_privilege('service_role','public.note_runs_due(bigint,bigint)','execute')
  and not has_function_privilege('authenticated','public.note_runs_due(bigint,bigint)','execute'),
 'handovers_due', position('company uuid' in pg_get_function_result('public.handovers_due(uuid,bigint,uuid)'::regprocedure))>0
  and position('h.company_id' in pg_get_functiondef('public.handovers_due(uuid,bigint,uuid)'::regprocedure))>0
  and has_function_privilege('service_role','public.handovers_due(uuid,bigint,uuid)','execute')
  and not has_function_privilege('authenticated','public.handovers_due(uuid,bigint,uuid)','execute')
);
