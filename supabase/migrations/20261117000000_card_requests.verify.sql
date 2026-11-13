select json_build_object(
 'mode_column_limited_to_three_modes',exists(select 1 from pg_constraint where conrelid='public.work_cards'::regclass and contype='c' and pg_get_constraintdef(oid) like '%plan%' and pg_get_constraintdef(oid) like '%do%' and pg_get_constraintdef(oid) like '%answer%'),
 'old_cards_keep_no_mode',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='mode' and is_nullable='NO'),
 'request_function_for_signed_in_people',has_function_privilege('authenticated','public.create_card_request(uuid,text,uuid,text)','execute') and not has_function_privilege('anon','public.create_card_request(uuid,text,uuid,text)','execute'),
 'request_function_runs_as_the_caller',not (select prosecdef from pg_proc where oid='public.create_card_request(uuid,text,uuid,text)'::regprocedure),
 'ideas_is_a_stage_kind_with_one_per_company',exists(select 1 from pg_indexes where schemaname='public' and indexname='work_stages_one_ideas') and not exists(select 1 from public.companies c where (select count(*) from public.work_stages s where s.company_id=c.id and s.kind='ideas')<>1),
 'request_keys_do_not_need_a_membership',not exists(select 1 from pg_constraint where conrelid='public.agent_requests'::regclass and contype='f' and confrelid='public.members'::regclass) and exists(select 1 from pg_policies where schemaname='public' and tablename='agent_requests' and policyname='agent_requests_insert' and with_check like '%is_member%'),
 'granted_agents_for_members',has_function_privilege('authenticated','public.company_agents(uuid)','execute') and not has_function_privilege('anon','public.company_agents(uuid)','execute'),
 'idempotent_write_creates_requests',position('create_card_request' in pg_get_functiondef('public.agent_write(uuid,text,text,text,bigint,jsonb)'::regprocedure))>0 and position('agent_requests' in pg_get_functiondef('public.agent_write(uuid,text,text,text,bigint,jsonb)'::regprocedure))>0
);
