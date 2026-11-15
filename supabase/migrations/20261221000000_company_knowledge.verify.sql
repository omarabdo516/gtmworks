-- Every Member reads their own Company's knowledge and nobody writes it but the one checked save, which only an active
-- Owner or Manager passes; each edit reaches the Company's log. The worker alone pins a run's knowledge.
select json_build_object(
 'members_read_only',(select relrowsecurity from pg_class where oid='public.company_knowledge'::regclass)
  and has_table_privilege('authenticated','public.company_knowledge','select')
  and not has_table_privilege('authenticated','public.company_knowledge','insert,update,delete,truncate')
  and not has_table_privilege('anon','public.company_knowledge','select,insert,update,delete,truncate')
  and not has_table_privilege('service_role','public.company_knowledge','select,insert,update,delete,truncate')
  and position('is_member(company_id)' in (select qual from pg_policies where schemaname='public' and tablename='company_knowledge' and policyname='company_knowledge_read'))>0
  and not exists(select 1 from pg_policies where schemaname='public' and tablename='company_knowledge' and cmd<>'SELECT'),
 'gone_with_its_company',(select confdeltype='c' from pg_constraint where conrelid='public.company_knowledge'::regclass and contype='f' and confrelid='public.companies'::regclass),
 'parts_in_order',public.company_knowledge_parts()=array['voice','audience','products','banned','decisions'],
 'saved_by_owner_or_manager',has_function_privilege('authenticated','public.save_company_knowledge(uuid,text,text)','execute')
  and not has_function_privilege('anon','public.save_company_knowledge(uuid,text,text)','execute')
  and not has_function_privilege('service_role','public.save_company_knowledge(uuid,text,text)','execute')
  and (select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.save_company_knowledge(uuid,text,text)'::regprocedure)
  and position('can_manage_company(c)' in pg_get_functiondef('public.save_company_knowledge(uuid,text,text)'::regprocedure))>0
  and position('secret_like(kept)' in pg_get_functiondef('public.save_company_knowledge(uuid,text,text)'::regprocedure))>0,
 'edits_logged',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_action_check')) like '%company_knowledge_changed%'
  and position('company_knowledge_changed' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0
  and position('agent_level_changed' in pg_get_functiondef('public.log_company_change()'::regprocedure))>0,
 'worker_pins',has_function_privilege('service_role','public.pin_run_knowledge(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.pin_run_knowledge(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.pin_run_knowledge(uuid,uuid)','execute'),
 'pin_optional',(select format_type(atttypid,atttypmod)='jsonb' and not attnotnull from pg_attribute where attrelid='public.conversation_run_notes'::regclass and attname='knowledge' and not attisdropped)
  and not has_column_privilege('service_role','public.conversation_run_notes','knowledge','select')
  and not has_column_privilege('authenticated','public.conversation_run_notes','knowledge','select'),
 'parts_private',(select bool_and(not has_function_privilege(r,'public.company_knowledge_parts()','execute') and not has_function_privilege(r,'public.company_knowledge_now(uuid)','execute')) from unnest(array['anon','authenticated','service_role']) r),
 'channel_runs_pin',exists(select 1 from pg_trigger where tgrelid='public.channel_runs'::regclass and tgname='channel_runs_knowledge' and not tgisinternal)
  and has_function_privilege('service_role','public.channel_run_knowledge(bigint)','execute')
  and not has_function_privilege('authenticated','public.channel_run_knowledge(bigint)','execute')
  and not has_column_privilege('authenticated','public.channel_runs','knowledge','select')
);
