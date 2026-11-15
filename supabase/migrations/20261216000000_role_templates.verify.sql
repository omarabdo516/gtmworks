-- An Agent keeps the ready-made role it was made from and its fitted instructions; the worker reads only the instructions,
-- and the one lead_create_agent (a cast to regproc fails on an overload) still answers the previous app version's call.
select json_build_object(
 'agent_columns_optional',(select count(*)=2 and bool_and(not attnotnull) from pg_attribute where attrelid='public.hermes_agents'::regclass and attname in ('template','instructions') and not attisdropped),
 'instructions_read_by_worker',has_column_privilege('service_role','public.hermes_agents','instructions','select')
  and not has_column_privilege('service_role','public.hermes_agents','template','select'),
 'previous_call_answered',(select pronargs-pronargdefaults=6 from pg_proc where oid='public.lead_create_agent'::regproc),
 'fitted_with_company',position('{company}' in pg_get_functiondef('public.lead_create_agent'::regproc))>0
);
