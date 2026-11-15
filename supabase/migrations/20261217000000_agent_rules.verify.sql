select json_build_object(
 'rules_read_only',(select relrowsecurity from pg_class where oid='public.agent_rules'::regclass)
  and has_table_privilege('authenticated','public.agent_rules','select')
  and not has_table_privilege('authenticated','public.agent_rules','insert,update,delete')
  and not has_table_privilege('anon','public.agent_rules','select,insert,update,delete')
  and not has_table_privilege('service_role','public.agent_rules','select,insert,update,delete'),
 'rules_follow_visibility',position('can_see_agent' in (select qual from pg_policies where tablename='agent_rules' and policyname='agent_rules_read'))>0
  and position('agent_visible_to' in pg_get_functiondef('public.may_tell_agent_rules(uuid,uuid,uuid)'::regprocedure))>0,
 'rules_kept_when_agent_goes',(select confdeltype='n' from pg_constraint where conrelid='public.agent_rules'::regclass and contype='f' and confrelid='public.hermes_agents'::regclass),
 'pins_optional',(select count(*)=2 and bool_and(not attnotnull) from pg_attribute where attrelid='public.conversation_run_notes'::regclass and attname in ('tools','rules') and not attisdropped),
 'worker_saves_and_reads_pins',has_function_privilege('service_role','public.agent_save_rule(uuid,text,text,text)','execute')
  and has_function_privilege('service_role','public.pin_run(uuid,uuid,jsonb)','execute')
  and (select bool_and(not has_function_privilege(r,'public.agent_save_rule(uuid,text,text,text)','execute') and not has_function_privilege(r,'public.pin_run(uuid,uuid,jsonb)','execute'))
   from unnest(array['anon','authenticated']) r),
 'people_remove',has_function_privilege('authenticated','public.remove_agent_rule(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.remove_agent_rule(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.remove_agent_rule(uuid,uuid)','execute'),
 'rules_private',(select bool_and(not has_function_privilege(r,'public.may_tell_agent_rules(uuid,uuid,uuid)','execute')
   and not has_function_privilege(r,'public.run_tools(uuid,uuid,uuid)','execute') and not has_function_privilege(r,'public.agent_rules_in_force(uuid)','execute'))
  from unnest(array['anon','authenticated','service_role']) r),
 'offer_and_rules_pinned',position('run_tools' in pg_get_functiondef('public.pin_run(uuid,uuid,jsonb)'::regprocedure))>0
  and position('agent_rules_in_force' in pg_get_functiondef('public.pin_run(uuid,uuid,jsonb)'::regprocedure))>0
  and position('run_tools' in pg_get_functiondef('public.pinned_run_note(uuid,uuid,uuid,uuid)'::regprocedure))=0,
 'rule_from_person',position('rule_words(m.body)=public.rule_words(said)' in pg_get_functiondef('public.agent_save_rule(uuid,text,text,text)'::regprocedure))>0
  and public.rule_words(E' @Ads From now on:  no emojis!\n')=public.rule_words('from now on: no emojis') and public.rule_words('Never send customer data')<>public.rule_words('send customer data'),
 'previous_app_pins_as_before',has_function_privilege('service_role','public.run_offers_tools(uuid,uuid)','execute') and has_function_privilege('service_role','public.pin_run_tools(uuid,uuid,text)','execute'),
 'logged_with_rule',public.log_agent_action('AGENT_RULE_SAVED')='agent_rule_saved' and public.log_agent_action('AGENT_RULE_REMOVED')='agent_rule_removed'
  and position('''rule''' in pg_get_functiondef('public.log_agent_change()'::regprocedure))>0
);
