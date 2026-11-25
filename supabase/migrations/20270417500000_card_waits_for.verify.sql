-- #682: a Card waits for other Cards; a loop is refused by the table itself; the waits are read and written through
-- functions for signed-in Members only.
select json_build_object(
 'waits',to_regclass('public.work_card_waits') is not null,
 'no_loop',exists(select 1 from pg_trigger where tgrelid='public.work_card_waits'::regclass and tgname='work_card_waits_no_loop' and not tgisinternal),
 'archive_releases',exists(select 1 from pg_trigger where tgrelid='public.work_cards'::regclass and tgname='work_cards_release_waits' and not tgisinternal),
 'read_rules',(select count(*)=2 from pg_policies where schemaname='public' and tablename='work_card_waits' and policyname in ('work_read','card_agent_visible')),
 'written_by_functions_only',not has_table_privilege('authenticated','public.work_card_waits','insert') and not has_table_privilege('authenticated','public.work_card_waits','delete'),
 'functions',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.add_card_wait(uuid,bigint,bigint)','public.remove_card_wait(uuid,bigint,bigint)','public.card_wait_links(uuid,bigint)','public.open_card_waits(uuid)']::regprocedure[]) f),
 'no_loop_stored',not exists(with recursive walk(start,id) as (select card_id,waits_for from public.work_card_waits union select w.start,x.waits_for from walk w join public.work_card_waits x on x.card_id=w.id) select 1 from walk where start=id)
);
