-- #683: one New card form makes a Card with its status, description, assignee and Project, once per request key, for
-- signed-in Members only.
select json_build_object(
 'request_key',exists(select 1 from pg_indexes where schemaname='public' and indexname='work_cards_request_key'),
 'new_card',has_function_privilege('authenticated','public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)','execute')
  and not has_function_privilege('anon','public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)','execute')
  and not has_function_privilege('service_role','public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)','execute')
);
