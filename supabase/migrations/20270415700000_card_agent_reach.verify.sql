-- #367: the Card's read rule and the rule every row written on a Card asks both follow the Card's own Agent, and
-- can_see_card keeps its security, search path and grants. Since #677 (spec #668) that Agent is the Card's assignee
-- Agent and the chat's Agent no longer hides it, so this asserts the final rule.
select json_build_object(
 'card_follows_its_agent',(select permissive='RESTRICTIVE' and cmd='SELECT' and roles=array['authenticated']::name[]
   and qual like '%can_see_agent(company_id, assignee_agent)%' and qual not like '%conversation%'
  from pg_policies where schemaname='public' and tablename='work_cards' and policyname='card_agent_visible'),
 'rows_follow_its_agent',position('can_see_agent' in pg_get_functiondef('public.can_see_card(uuid,bigint)'::regprocedure))>0
  and position('assignee_agent' in pg_get_functiondef('public.can_see_card(uuid,bigint)'::regprocedure))>0,
 'rule_unchanged_else',(select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.can_see_card(uuid,bigint)'::regprocedure)
  and has_function_privilege('authenticated','public.can_see_card(uuid,bigint)','execute')
  and not has_function_privilege('anon','public.can_see_card(uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.can_see_card(uuid,bigint)','execute')
);
