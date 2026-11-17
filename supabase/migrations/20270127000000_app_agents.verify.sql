-- Per-Agent apps (#30): only a signed-in person reaches the Agent list and the two new app functions, each runs as its
-- owner with an empty search path, checks the Owner and that the Agent's profile is its own; the list shows only the
-- Agents the caller sees; a sign-in and a log row keep their Agent, null on old rows; the 3- and 2-argument functions
-- stay for the previous app version; the log names the Agent beside the app.
select json_build_object(
 'signed_in_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.company_app_agents(uuid)','public.start_app_sign_in(uuid,text,text,uuid)','public.record_app_disconnected(uuid,text,uuid)','public.start_app_sign_in(uuid,text,text)','public.record_app_disconnected(uuid,text)','public.finish_app_sign_in(text,text)']) f),
 'run_as_owner',(select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.company_app_agents(uuid)'::regprocedure,'public.start_app_sign_in(uuid,text,text,uuid)'::regprocedure,'public.record_app_disconnected(uuid,text,uuid)'::regprocedure,'public.finish_app_sign_in(text,text)'::regprocedure)),
 'check_owner_and_own_agent',(select bool_and(position('is_company_owner(c)' in pg_get_functiondef(f::regprocedure))>0 and position('company_app_agents(c)' in pg_get_functiondef(f::regprocedure))>0 and position('x.own' in pg_get_functiondef(f::regprocedure))>0)
  from unnest(array['public.start_app_sign_in(uuid,text,text,uuid)','public.record_app_disconnected(uuid,text,uuid)']) f),
 'agents_seen_only',position('can_see_agent(c,a.id)' in pg_get_functiondef('public.company_app_agents(uuid)'::regprocedure))>0
  and position('is_bundled_connection(h.id)' in pg_get_functiondef('public.company_app_agents(uuid)'::regprocedure))>0,
 'agent_kept',(select count(*)=2 from pg_attribute where attname='agent_id' and not attisdropped and not attnotnull and atttypid='uuid'::regtype
  and attrelid in ('public.company_app_sign_ins'::regclass,'public.company_audit'::regclass)),
 'finish_keeps_agent',position('pending.agent_id' in pg_get_functiondef('public.finish_app_sign_in(text,text)'::regprocedure))>0
  and position('started_by=auth.uid()' in pg_get_functiondef('public.finish_app_sign_in(text,text)'::regprocedure))>0,
 'audit_closed',not has_table_privilege('authenticated','public.company_audit','insert') and not has_table_privilege('service_role','public.company_audit','insert')
  and not has_table_privilege('authenticated','public.company_app_sign_ins','insert') and not has_table_privilege('authenticated','public.company_app_sign_ins','update'),
 'agent_logged',(select bool_and(position(t in pg_get_functiondef('public.log_company_change()'::regprocedure))>0) from unnest(array['agent_name','app_connected','provider_key_set','agent_level_changed','company_knowledge_changed','old_name']) t)
);
