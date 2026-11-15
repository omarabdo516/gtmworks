select json_build_object(
 'switches_read_only',(select relrowsecurity from pg_class where oid='public.member_agent_access'::regclass)
  and has_table_privilege('authenticated','public.member_agent_access','select')
  and not has_table_privilege('authenticated','public.member_agent_access','insert,update,delete')
  and not has_table_privilege('anon','public.member_agent_access','select,insert,update,delete')
  and not has_table_privilege('service_role','public.member_agent_access','select,insert,update,delete'),
 'changed_by_people',has_function_privilege('authenticated','public.set_agent_visible(uuid,uuid,uuid,boolean)','execute')
  and not has_function_privilege('anon','public.set_agent_visible(uuid,uuid,uuid,boolean)','execute')
  and not has_function_privilege('service_role','public.set_agent_visible(uuid,uuid,uuid,boolean)','execute'),
 'reads_filtered',(select bool_and(position('agent_visible_to' in qual)>0) from pg_policies where schemaname='public'
  and (tablename,policyname) in (('hermes_agents','hermes_agents_read'),('hermes_agent_audit','hermes_agent_audit_read'),('conversations','conversations_read'),('company_log','company_log_read')))
  and (select count(*)=4 from pg_policies where schemaname='public' and position('agent_visible_to' in qual)>0),
 'writes_refused',(select count(*)=3 from pg_trigger where tgfoid='public.refuse_hidden_agent()'::regprocedure and not tgisinternal
  and tgrelid in ('public.conversations'::regclass,'public.conversation_run_reservations'::regclass,'public.conversation_queued_turns'::regclass))
);
