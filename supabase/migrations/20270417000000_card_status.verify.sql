-- #676: a Card's status is its column, moved by move_card (rules in check_card_move) and put back by undo_card_move, for
-- signed-in Members only; until the cutover (#684) each Card's stage stays in its status's column.
select json_build_object(
 'status',exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='status' and is_nullable='NO'),
 'six_columns',exists(select 1 from pg_constraint where conrelid='public.work_cards'::regclass and conname='work_cards_status_known'),
 'member_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.move_card(uuid,bigint,text,bigint,text)','public.undo_card_move(uuid,bigint)','public.check_card_move(uuid,bigint,text)']) f),
 'both_shapes',exists(select 1 from pg_trigger where tgrelid='public.work_cards'::regclass and tgname='align_card_status' and not tgisinternal),
 'status_is_stage_column',not exists(select 1 from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id where w.status is distinct from s.board_column),
 'moves_in_both_shapes',(select count(*)=2 from information_schema.columns where table_schema='public' and table_name='work_card_moves' and column_name in ('from_status','to_status'))
);
