-- Agents' looks (#696, ADR 0027): every Member reads the Company's looks under row-level security, nobody writes the
-- table by hand, every Agent has one, only an Owner changes one through its function, and only the worker gives Lead's
-- temperament.
select json_build_object(
 'looks_rls',(select relrowsecurity from pg_class where oid='public.agent_looks'::regclass),
 'looks_members_read',has_table_privilege('authenticated','public.agent_looks','select')
  and (select bool_and(position('is_member(company_id)' in pg_get_expr(polqual,polrelid))>0) from pg_policy where polrelid='public.agent_looks'::regclass),
 'looks_closed',not has_table_privilege('authenticated','public.agent_looks','insert') and not has_table_privilege('authenticated','public.agent_looks','update')
  and not has_table_privilege('authenticated','public.agent_looks','delete') and not has_table_privilege('anon','public.agent_looks','select')
  and not has_table_privilege('service_role','public.agent_looks','insert'),
 'looks_outlive_their_agent',not exists(select 1 from pg_constraint where conrelid='public.agent_looks'::regclass and contype='f' and confrelid='public.hermes_agents'::regclass),
 'every_agent_has_a_look',not exists(select 1 from public.hermes_agents a where not exists(select 1 from public.agent_looks l where l.agent_id=a.id)),
 'given_when_made',exists(select 1 from pg_trigger where tgrelid='public.hermes_agents'::regclass and tgname='agent_look_given' and tgenabled<>'D'),
 'temperaments_closed',(select relrowsecurity from pg_class where oid='public.lead_agent_temperaments'::regclass)
  and not has_table_privilege('authenticated','public.lead_agent_temperaments','select') and not has_table_privilege('service_role','public.lead_agent_temperaments','insert'),
 'change_signed_in_only',has_function_privilege('authenticated','public.change_agent_look(uuid,uuid,text,text)','execute')
  and not has_function_privilege('anon','public.change_agent_look(uuid,uuid,text,text)','execute')
  and not has_function_privilege('service_role','public.change_agent_look(uuid,uuid,text,text)','execute'),
 'change_as_owner',(select prosecdef and proconfig @> array['search_path=""'] and position('is_company_owner(c)' in pg_get_functiondef(oid))>0
  from pg_proc where oid='public.change_agent_look(uuid,uuid,text,text)'::regprocedure),
 'reset_signed_in_only',has_function_privilege('authenticated','public.reset_agent_look(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.reset_agent_look(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.reset_agent_look(uuid,uuid)','execute'),
 'temperament_worker_only',has_function_privilege('service_role','public.lead_agent_temperament(uuid,text,text,text)','execute')
  and not has_function_privilege('authenticated','public.lead_agent_temperament(uuid,text,text,text)','execute')
  and not has_function_privilege('anon','public.lead_agent_temperament(uuid,text,text,text)','execute'),
 'give_inside_only',not has_function_privilege('authenticated','public.give_agent_look(uuid,uuid,boolean,text,bigint)','execute')
  and not has_function_privilege('service_role','public.give_agent_look(uuid,uuid,boolean,text,bigint)','execute'),
 'request_given_its_look',position('give_agent_look' in pg_get_functiondef('public.lead_request_agent(uuid,text,text,text,text,text[],text,text)'::regprocedure))>0
);
