-- A restored rule is checked and logged by the database, and the restore function stays with signed-in callers.
select json_build_object(
 'restore_for_members',has_function_privilege('authenticated','public.restore_agent_rule(uuid,uuid)','execute'),
 'restore_private',not has_function_privilege('anon','public.restore_agent_rule(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.restore_agent_rule(uuid,uuid)','execute'),
 'same_checks_as_remove',position('may_tell_agent_rules' in pg_get_functiondef('public.restore_agent_rule(uuid,uuid)'::regprocedure))>0
  and position('can_see_agent' in pg_get_functiondef('public.restore_agent_rule(uuid,uuid)'::regprocedure))>0,
 'clears_the_removal',position('removed_at=null' in pg_get_functiondef('public.restore_agent_rule(uuid,uuid)'::regprocedure))>0
  and position('AGENT_RULE_RESTORED' in pg_get_functiondef('public.restore_agent_rule(uuid,uuid)'::regprocedure))>0
);
