-- #680: the description saves over the version its writer read, for signed-in Members only, and every version is kept.
select json_build_object(
 'versions',to_regclass('public.work_card_description_versions') is not null,
 'kept',exists(select 1 from pg_trigger where tgrelid='public.work_cards'::regclass and tgname='work_cards_keep_description' and not tgisinternal),
 'every_card_has_its_version',not exists(select 1 from public.work_cards w where not exists(select 1 from public.work_card_description_versions v where v.card_id=w.id and v.version=w.description_version)),
 'read_rules',(select count(*)=2 from pg_policies where schemaname='public' and tablename='work_card_description_versions' and policyname in ('work_read','card_agent_visible')),
 'written_by_functions_only',not has_table_privilege('authenticated','public.work_card_description_versions','insert') and not has_table_privilege('authenticated','public.work_card_description_versions','update'),
 'save',has_function_privilege('authenticated','public.save_card_description(uuid,bigint,text,integer)','execute') and not has_function_privilege('anon','public.save_card_description(uuid,bigint,text,integer)','execute') and not has_function_privilege('service_role','public.save_card_description(uuid,bigint,text,integer)','execute')
);
