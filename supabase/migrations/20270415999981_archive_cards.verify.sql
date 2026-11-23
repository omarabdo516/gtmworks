-- #670: an archived Card is a time and a person on it; reads as the signed-in person see current Cards only, and the three
-- archive functions are the signed-in person's own, run as their definer with an empty search path.
select json_build_object(
 'columns',(select count(*)=2 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name in ('archived_at','archived_by') and is_nullable='YES'),
 'current_only',exists(select 1 from pg_policies where schemaname='public' and tablename='work_cards' and policyname='card_current' and permissive='RESTRICTIVE' and cmd='SELECT'),
 'member_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('service_role',f,'execute')) from unnest(array['public.archived_cards(uuid)','public.archive_cards(uuid,bigint[])','public.restore_cards(uuid,bigint[])']) f),
 'as_definer',(select count(*)=3 and bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.archived_cards(uuid)'::regprocedure,'public.archive_cards(uuid,bigint[])'::regprocedure,'public.restore_cards(uuid,bigint[])'::regprocedure)),
 'role_checked',position('public.work_can_edit(c)' in pg_get_functiondef('public.archive_cards(uuid,bigint[])'::regprocedure))>0
  and position('public.work_can_edit(c)' in pg_get_functiondef('public.restore_cards(uuid,bigint[])'::regprocedure))>0,
 'channel_card_current',position('archived_at is null' in pg_get_functiondef('public.channel_board_card(uuid)'::regprocedure))>0
);
