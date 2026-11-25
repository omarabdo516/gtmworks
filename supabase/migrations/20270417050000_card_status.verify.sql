-- #676: a Card's status is its column, moved by move_card (rules in check_card_move) and put back by undo_card_move, for
-- signed-in Members only. The cutover (#684) took the stages and the trigger that kept them in step away.
select json_build_object(
 'status',exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='status' and is_nullable='NO'),
 'six_columns',exists(select 1 from pg_constraint where conrelid='public.work_cards'::regclass and conname='work_cards_status_known'),
 'member_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.move_card(uuid,bigint,text,bigint,text)','public.undo_card_move(uuid,bigint)','public.check_card_move(uuid,bigint,text)']) f),
 'one_shape',not exists(select 1 from pg_trigger where tgrelid='public.work_cards'::regclass and tgname='align_card_status' and not tgisinternal)
  and to_regclass('public.work_stages') is null and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='stage_id'),
 'moves_by_status',(select count(*)=2 from information_schema.columns where table_schema='public' and table_name='work_card_moves' and column_name in ('from_status','to_status'))
  and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_card_moves' and column_name in ('from_stage_id','to_stage_id'))
);
