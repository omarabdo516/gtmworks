-- Each edit of a part reaches the Company's log, and the parts keep their order. The table, its save and the run pins
-- were dropped by 20270209000000 (#344), whose own check proves them gone.
select json_build_object(
 'parts_in_order',public.company_knowledge_parts()=array['voice','audience','products','banned','decisions'],
 'edits_logged',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_action_check')) like '%company_knowledge_changed%'
  and position('company_knowledge_changed' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0
  and position('agent_level_changed' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0
);
