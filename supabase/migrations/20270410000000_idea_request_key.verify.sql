-- #452: an idea is made once per request key. agent_write, which made it, went with the request form (#683, #684); a
-- Card is made with new_card, which returns the Card already made under the same key, and a key is one per Company.
select json_build_object(
 'previous_app_calls_resolve',to_regprocedure('public.agent_write(uuid,text,text,text,bigint,jsonb)') is null,
 'one_card_per_key',exists(select 1 from pg_indexes where schemaname='public' and tablename='work_cards' and indexname='work_cards_request_key' and indexdef like '%UNIQUE%' and indexdef like '%company_id, request_key%'),
 'key_answered_with_its_card',position('w.request_key=new_card.request_key' in pg_get_functiondef('public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)'::regprocedure))>0,
 'search_path_kept',(select proconfig=array['search_path=""'] from pg_proc where oid='public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)'::regprocedure),
 'grants_kept',has_function_privilege('authenticated','public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)','execute') and not has_function_privilege('anon','public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)','execute')
);
