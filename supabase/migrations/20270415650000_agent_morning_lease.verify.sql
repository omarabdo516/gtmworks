-- #182: Good morning's lease is private, taken and given back by an Owner's or a Manager's own session only.
select json_build_object(
 'table_private',not has_table_privilege('authenticated','public.agent_morning_leases','select')
  and not has_table_privilege('anon','public.agent_morning_leases','select'),
 'take_for_members',has_function_privilege('authenticated','public.take_morning_lease(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.take_morning_lease(uuid,uuid)','execute'),
 'drop_for_members',has_function_privilege('authenticated','public.drop_morning_lease(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.drop_morning_lease(uuid,uuid)','execute'),
 'managers_checked',position('can_manage_company' in pg_get_functiondef('public.take_morning_lease(uuid,uuid)'::regprocedure))>0
);
