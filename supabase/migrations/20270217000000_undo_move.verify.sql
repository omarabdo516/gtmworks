-- "Undo" on a move (#168) is a new table of moves, written by the Card table, and a function that puts the caller's own
-- latest move of a Card back as the caller, refusing anyone who may not move it, a Card moved on since, and "Waiting on
-- you". Nothing it adds is readable or writable by a client but the moves a Member reads and the function they call.
select json_build_object(
 'moves_table',to_regclass('public.work_card_moves') is not null,
 'moves_company_owned',exists(select 1 from pg_attribute where attrelid='public.work_card_moves'::regclass and attname='company_id' and not attisdropped),
 'moves_row_security',(select relrowsecurity from pg_class where oid='public.work_card_moves'::regclass),
 'moves_read_for_members',has_table_privilege('authenticated','public.work_card_moves','SELECT')
  and not has_table_privilege('authenticated','public.work_card_moves','INSERT')
  and not has_table_privilege('authenticated','public.work_card_moves','UPDATE')
  and not has_table_privilege('authenticated','public.work_card_moves','DELETE')
  and not has_table_privilege('anon','public.work_card_moves','SELECT'),
 'moves_follow_the_card',(select qual from pg_policies where schemaname='public' and tablename='work_card_moves' and policyname='work_card_moves_read') like '%work_cards%'
  and (select qual from pg_policies where schemaname='public' and tablename='work_card_moves' and policyname='work_card_moves_read') like '%auth.uid()%',
 'every_move_remembered',exists(select 1 from pg_trigger where tgrelid='public.work_cards'::regclass and tgname='work_card_moved' and tgenabled='O' and (tgtype&16)=16),
 'recorder_private',not has_function_privilege('authenticated','public.work_card_moved()','execute'),
 'decisions_not_undone',position('approval.internal' in pg_get_functiondef('public.work_card_moved()'::regprocedure))>0,
 'undo_for_members',has_function_privilege('authenticated','public.undo_work_card_move(uuid,bigint)','execute')
  and not has_function_privilege('anon','public.undo_work_card_move(uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.undo_work_card_move(uuid,bigint)','execute'),
 'undo_restores_the_stage',position('set stage_id=moved.from_stage_id' in pg_get_functiondef('public.undo_work_card_move(uuid,bigint)'::regprocedure))>0,
 'undo_restores_the_place',position('board_order=moved.from_place' in pg_get_functiondef('public.undo_work_card_move(uuid,bigint)'::regprocedure))>0,
 'undo_is_the_persons',position('m.person_id=auth.uid()' in pg_get_functiondef('public.undo_work_card_move(uuid,bigint)'::regprocedure))>0,
 'undo_checks_the_place',position('the card moved on' in pg_get_functiondef('public.undo_work_card_move(uuid,bigint)'::regprocedure))>0,
 'undo_refuses_waiting',position('waiting is not placed by hand' in pg_get_functiondef('public.undo_work_card_move(uuid,bigint)'::regprocedure))>0,
 'undo_checks_after_review',position('can_manage_company' in pg_get_functiondef('public.undo_work_card_move(uuid,bigint)'::regprocedure))>0,
 'one_place_per_move',position('work.place_exact' in pg_get_functiondef('public.place_work_card(uuid,bigint,text,bigint,text)'::regprocedure))>0,
 'moved_back_logged',position('''card_moved_back''' in pg_get_functiondef('public.work_audit()'::regprocedure))>0,
 'moved_back_names_columns',position('old_column' in pg_get_functiondef('public.work_audit()'::regprocedure))>0
  and position('new_column' in pg_get_functiondef('public.work_audit()'::regprocedure))>0
);
