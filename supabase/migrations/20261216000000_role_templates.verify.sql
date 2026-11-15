-- An Agent keeps the ready-made role it was made from and its fitted instructions; the worker reads only the instructions,
-- and the one lead_create_agent (a cast to regproc fails on an overload) still answers the previous app version's call.
-- A run's tools are kept as the text sent (jsonb would reorder their keys), pinned only through the service role. The
-- previous app version's run_offers_tools now pins #89's spec, so it writes; that spec is held once, in a function no
-- role may call.
select json_build_object(
 'agent_columns_optional',(select count(*)=2 and bool_and(not attnotnull) from pg_attribute where attrelid='public.hermes_agents'::regclass and attname in ('template','instructions') and not attisdropped),
 'instructions_read_by_worker',has_column_privilege('service_role','public.hermes_agents','instructions','select')
  and not has_column_privilege('service_role','public.hermes_agents','template','select'),
 'previous_call_answered',(select pronargs-pronargdefaults=6 from pg_proc where oid='public.lead_create_agent'::regproc),
 'fitted_with_company',position('{company}' in pg_get_functiondef('public.lead_create_agent'::regproc))>0,
 'run_tools_as_sent',(select format_type(atttypid,atttypmod)='text' and not attnotnull from pg_attribute where attrelid='public.conversation_run_notes'::regclass and attname='tools' and not attisdropped)
  and not has_column_privilege('service_role','public.conversation_run_notes','tools','select')
  and has_function_privilege('service_role','public.pin_run_tools(uuid,uuid,text)','execute')
  and not has_function_privilege('authenticated','public.pin_run_tools(uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.pin_run_tools(uuid,uuid,text)','execute'),
 'previous_app_pins_89',(select provolatile='v' and prosecdef and proconfig=array['search_path=""']::text[] from pg_proc where oid='public.run_offers_tools(uuid,uuid)'::regprocedure)
  and position('lead_tools_spec_89' in pg_get_functiondef('public.run_offers_tools(uuid,uuid)'::regprocedure))>0
  and has_function_privilege('service_role','public.run_offers_tools(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.run_offers_tools(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.run_offers_tools(uuid,uuid)','execute'),
 'spec_89_private',(select provolatile='i' from pg_proc where oid='public.lead_tools_spec_89()'::regprocedure)
  and (select bool_and(not has_function_privilege(r,'public.lead_tools_spec_89()','execute')) from unnest(array['public','anon','authenticated','service_role']) r)
);
