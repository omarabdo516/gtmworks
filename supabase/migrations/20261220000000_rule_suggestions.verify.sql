select json_build_object(
 'suggestion_optional',(select count(*)=3 and bool_and(not attnotnull) from pg_attribute where attrelid='public.agent_rules'::regclass and attname in ('suggestion','decided_by','decided_at') and not attisdropped)
  and exists(select 1 from pg_constraint where conrelid='public.agent_rules'::regclass and conname='agent_rules_decision'),
 'suggestions_read_by_teller_and_deciders',position('said_by = auth.uid()' in (select qual from pg_policies where tablename='agent_rules' and policyname='agent_rules_read'))>0
  and position('can_manage_company' in (select qual from pg_policies where tablename='agent_rules' and policyname='agent_rules_read'))>0,
 'contributor_offered_suggest_rule',position('may_suggest_agent_rules' in pg_get_functiondef('public.run_tools(uuid,uuid,uuid)'::regprocedure))>0
  and position('''contributor''' in pg_get_functiondef('public.may_suggest_agent_rules(uuid,uuid,uuid)'::regprocedure))>0,
 -- No Run is told rules any more, and the per-person list is gone (#345, 20270210000000).
 'private_helpers',(select bool_and(not has_function_privilege(r,'public.may_suggest_agent_rules(uuid,uuid,uuid)','execute')) from unnest(array['anon','authenticated','service_role']) r),
 'people_decide',has_function_privilege('authenticated','public.decide_agent_rule(uuid,bigint,boolean)','execute')
  and not has_function_privilege('anon','public.decide_agent_rule(uuid,bigint,boolean)','execute')
  and not has_function_privilege('service_role','public.decide_agent_rule(uuid,bigint,boolean)','execute')
  and has_function_privilege('authenticated','public.rule_suggestions_sent_to(uuid)','execute')
  and not has_function_privilege('anon','public.rule_suggestions_sent_to(uuid)','execute'),
 'waiting_names_rule',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.waiting_items'::regclass and conname='waiting_items_source') like '%agent_rule_id IS NOT NULL%'
  and not exists(select 1 from pg_constraint where conrelid='public.waiting_items'::regclass and conname='waiting_items_check')
  and position('can_decide_waiting_rule' in (select qual from pg_policies where tablename='waiting_items' and policyname='waiting_items_read'))>0,
 'waiting_list_unchanged',pg_get_function_result('public.waiting_list(uuid)'::regprocedure)='TABLE(kind text, id bigint, title text, body text, asked_by text, card_id bigint, conversation_id uuid, created_at timestamp with time zone)',
 'removal_resolves',position('waiting_items' in pg_get_functiondef('public.remove_agent_rule(uuid,uuid)'::regprocedure))>0,
 'suggestion_logged_privately',position('private' in (select qual from pg_policies where tablename='company_log' and policyname='company_log_read'))>0
  and public.log_agent_action('AGENT_RULE_SUGGESTED')='agent_rule_suggested' and public.log_agent_action('AGENT_RULE_APPROVED')='agent_rule_approved'
  and public.log_agent_action('AGENT_RULE_REJECTED')='agent_rule_rejected'
  and position('taught_by' in pg_get_functiondef('public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)'::regprocedure))>0
);
