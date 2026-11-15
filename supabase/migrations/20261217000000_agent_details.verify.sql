select json_build_object(
 'card_agent_optional',(select not attnotnull from pg_attribute where attrelid='public.work_cards'::regclass and attname='agent_id' and not attisdropped)
  and has_column_privilege('authenticated','public.work_cards','agent_id','select'),
 'card_agent_same_company',(select confrelid='public.hermes_agents'::regclass and confdeltype='n'
   and conkey=array[(select attnum from pg_attribute where attrelid='public.work_cards'::regclass and attname='company_id'),(select attnum from pg_attribute where attrelid='public.work_cards'::regclass and attname='agent_id')]::int2[]
   and confdelsetcols=array[(select attnum from pg_attribute where attrelid='public.work_cards'::regclass and attname='agent_id')]::int2[]
  from pg_constraint where conname='work_cards_agent_fkey' and conrelid='public.work_cards'::regclass),
 'indexed',to_regclass('public.work_cards_agent') is not null and to_regclass('public.conversations_agent') is not null,
 'open_run_for_people',has_function_privilege('authenticated','public.agent_open_run(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.agent_open_run(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.agent_open_run(uuid,uuid)','execute'),
 'open_run_no_text',pg_get_function_result('public.agent_open_run(uuid,uuid)'::regprocedure)='TABLE(started_at timestamp with time zone, conversation uuid)',
 'open_run_definer',(select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.agent_open_run(uuid,uuid)'::regprocedure),
 'open_run_shared_rule',position('conversation_open_run' in pg_get_functiondef('public.agent_open_run(uuid,uuid)'::regprocedure))>0
  and position('can_see_agent' in pg_get_functiondef('public.agent_open_run(uuid,uuid)'::regprocedure))>0
);
