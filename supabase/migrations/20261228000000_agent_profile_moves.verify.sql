-- Existing Agents move to their own profiles (#121, ADR 0016): the keeper record is closed to every client and holds one
-- Agent per Company, only the worker moves, the move checks the Agent's tools and everything in flight under the Run
-- lock, the keeper never moves, a moved Agent's Connection is bundled, the log names the move, and a Run's history is
-- the worker's alone.
select json_build_object(
 'keepers_closed',(select relrowsecurity from pg_class where oid='public.company_profile_keepers'::regclass)
  and (select bool_and(not has_table_privilege(r,'public.company_profile_keepers','select,insert,update,delete,truncate')) from unnest(array['anon','authenticated','service_role']) r),
 'one_keeper_per_company',exists(select 1 from pg_constraint where conrelid='public.company_profile_keepers'::regclass and contype='p'
  and conkey=array[(select attnum from pg_attribute where attrelid='public.company_profile_keepers'::regclass and attname='company_id')]),
 'worker_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.agent_move_work()','public.begin_agent_profile_move(uuid)','public.move_agent_profile(uuid)','public.pin_run_history(uuid,uuid)']) f),
 'helpers_private',(select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['public.company_profile_keeper(uuid)','public.agent_move_blocked(uuid)','public.agent_may_move(uuid)']) f),
 'move_under_run_lock',(select bool_and(position('hermes_agents'',0)' in pg_get_functiondef(f::regprocedure))>0) from unnest(array[
  'public.begin_agent_profile_move(uuid)','public.move_agent_profile(uuid)']) f),
 'move_checks_tools_and_flight',(select bool_and(position(t in pg_get_functiondef('public.move_agent_profile(uuid)'::regprocedure))>0)
  from unnest(array['agent_move_blocked','agent_may_move','company_profile_ready','engine_tool_policy','tools_pending']) t)
  and position('agent_move_blocked' in pg_get_functiondef('public.agent_move_work()'::regprocedure))>0,
 'every_blocker',(select bool_and(position(t in pg_get_functiondef('public.agent_move_blocked(uuid)'::regprocedure))>0)
  from unnest(array['conversation_usage','conversation_run_reservations','channel_runs','note_runs','5 minutes']) t),
 'keeper_never_moves',position('company_profile_keeper' in pg_get_functiondef('public.agent_may_move(uuid)'::regprocedure))>0,
 'moved_connection_bundled',(select bool_and(position(a in pg_get_functiondef('public.is_bundled_connection(uuid)'::regprocedure))>0)
  from unnest(array['PROVIDE_BUNDLED_HERMES_AGENT','MOVE_COMPANY_PROFILE','REQUEST_HERMES_AGENT','MOVE_AGENT_PROFILE']) a),
 'logged_as_own_space',public.log_agent_action('MOVE_AGENT_PROFILE')='agent_own_space'
  and public.log_agent_action('MOVE_COMPANY_PROFILE')='agent_own_profile' and public.log_agent_action('REQUEST_HERMES_AGENT')='agent_requested'
  and public.log_agent_action('DEFAULT_HERMES_AGENT')='agent_made_main',
 'history_optional',(select format_type(atttypid,atttypmod)='jsonb' and not attnotnull from pg_attribute where attrelid='public.conversation_run_notes'::regclass and attname='history' and not attisdropped)
  and not has_column_privilege('service_role','public.conversation_run_notes','history','select')
  and not has_column_privilege('authenticated','public.conversation_run_notes','history','select')
);
