-- The request form (a message to an Agent with a mode) was replaced by the one New card form (#683) and removed with the
-- Card cutover (#684): the mode, the request function and the Agent's write that called it are gone, and new_card makes
-- a Card for signed-in Members, as the caller, in Ideas, Planned or In progress. Request keys and granted Agents stay.
select json_build_object(
 'mode_gone',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='mode'),
 'request_function_replaced',to_regprocedure('public.create_card_request(uuid,text,uuid,text)') is null and to_regprocedure('public.agent_write(uuid,text,text,text,bigint,jsonb)') is null
  and has_function_privilege('authenticated','public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)','execute') and not has_function_privilege('anon','public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)','execute'),
 'new_card_runs_as_the_caller',not (select prosecdef from pg_proc where oid=to_regprocedure('public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)')),
 'ideas_is_a_status',to_regclass('public.work_stages') is null and position('''ideas''' in pg_get_functiondef(to_regprocedure('public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)')))>0,
 'request_keys_do_not_need_a_membership',not exists(select 1 from pg_constraint where conrelid='public.agent_requests'::regclass and contype='f' and confrelid='public.members'::regclass) and exists(select 1 from pg_policies where schemaname='public' and tablename='agent_requests' and policyname='agent_requests_insert' and with_check like '%is_member%'),
 'granted_agents_for_members',has_function_privilege('authenticated','public.company_agents(uuid)','execute') and not has_function_privilege('anon','public.company_agents(uuid)','execute')
);
