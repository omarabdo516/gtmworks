-- #701: the made Agent's one-time birth record and the function that keeps it.
select json_build_object(
 'column_added',(select count(*)=1 from pg_attribute where attrelid='public.hermes_agents'::regclass and attname='requester_born_at' and not attisdropped and not attnotnull),
 'requester_marks_once',has_function_privilege('authenticated','public.mark_agent_born(uuid)','execute')
  and not has_function_privilege('anon','public.mark_agent_born(uuid)','execute')
  and not has_function_privilege('service_role','public.mark_agent_born(uuid)','execute'),
 'mark_is_one_time',position('requester_born_at is null' in pg_get_functiondef('public.mark_agent_born(uuid)'::regprocedure))>0
  and position('requested_by=auth.uid()' in pg_get_functiondef('public.mark_agent_born(uuid)'::regprocedure))>0
);
