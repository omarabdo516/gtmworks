select json_build_object(
 'agent_columns_optional',(select bool_and(not attnotnull) from pg_attribute where attrelid='public.hermes_agents'::regclass and attname in ('created_at','requested_by','apps','requester_opened_at'))
  and (select count(*)=4 from pg_attribute where attrelid='public.hermes_agents'::regclass and attname in ('created_at','requested_by','apps','requester_opened_at') and not attisdropped),
 'agent_columns_readable',(select bool_and(has_column_privilege('authenticated','public.hermes_agents',c,'select')) from unnest(array['created_at','requested_by','apps','requester_opened_at']) c),
 'made_date_from_now_on',pg_get_expr((select adbin from pg_attrdef where adrelid='public.hermes_agents'::regclass and adnum=(select attnum from pg_attribute where attrelid='public.hermes_agents'::regclass and attname='created_at')),'public.hermes_agents'::regclass)='now()',
 'made_agents_read_only',(select relrowsecurity from pg_class where oid='public.lead_made_agents'::regclass)
  and has_table_privilege('authenticated','public.lead_made_agents','select')
  and not has_table_privilege('authenticated','public.lead_made_agents','insert,update,delete')
  and not has_table_privilege('service_role','public.lead_made_agents','select,insert,update,delete'),
 'worker_calls_only',has_function_privilege('service_role','public.lead_create_agent'::regproc,'execute')
  and not has_function_privilege('authenticated','public.lead_create_agent'::regproc,'execute')
  and not has_function_privilege('anon','public.lead_create_agent'::regproc,'execute')
  and has_function_privilege('service_role','public.run_offers_tools(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.run_offers_tools(uuid,uuid)','execute'),
 'rules_private',(select bool_and(not has_function_privilege(r,'public.may_use_lead_tools(uuid,uuid,uuid)','execute') and not has_function_privilege(r,'public.pinned_run_note(uuid,uuid,uuid,uuid)','execute'))
  from unnest(array['anon','authenticated','service_role']) r),
 'opened_by_people',has_function_privilege('authenticated','public.open_hermes_agent(uuid)','execute')
  and not has_function_privilege('anon','public.open_hermes_agent(uuid)','execute') and not has_function_privilege('service_role','public.open_hermes_agent(uuid)','execute'),
 'offer_pinned',position('may_use_lead_tools' in pg_get_functiondef('public.pinned_run_note(uuid,uuid,uuid,uuid)'::regprocedure))>0,
 -- One Hermes (#342): an Agent Lead makes runs on its own or its Company's profile.
 'lead_profile_own',position('agent_engine_profile(agent)' in pg_get_functiondef('public.lead_create_agent'::regproc))>0,
 'logged_with_job',public.log_agent_action('REQUEST_HERMES_AGENT')='agent_requested'
  and position('''job''' in pg_get_functiondef('public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)'::regprocedure))>0
);
