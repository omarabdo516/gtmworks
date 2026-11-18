-- Each Run's brief is pinned beside its note, written by the service role alone and never read by a person.
select json_build_object(
 'column',exists(select 1 from pg_attribute where attrelid='public.conversation_run_notes'::regclass and attname='lead_brief' and not attisdropped),
 'worker_only',has_function_privilege('service_role','public.pin_lead_brief(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.pin_lead_brief(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.pin_lead_brief(uuid,uuid)','execute'),
 'searched',(select bool_and(prosecdef and proconfig=array['search_path=""']) from pg_proc where oid='public.pin_lead_brief(uuid,uuid)'::regprocedure),
 'main_agent_only',position('a.is_default' in pg_get_functiondef('public.pin_lead_brief(uuid,uuid)'::regprocedure))>0,
 'sees_visible_agents',position('agent_visible_to' in pg_get_functiondef('public.pin_lead_brief(uuid,uuid)'::regprocedure))>0
);
