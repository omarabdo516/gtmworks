-- Every Card keeps a place in its column (#174); a Card made or moved to a column without one takes that column's end,
-- a Card a caller inserts without a place included. Placing is the signed-in person's, through move_card, whose check
-- (check_card_move) refuses "Waiting on you" and a Viewer; Live and Done are free for anyone who may edit since #676, and
-- place_work_card went with the Card cutover (#684). The column is additive with no default of its own.
select json_build_object(
 'place_column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='board_order' and data_type='numeric' and is_nullable='NO'),
 'no_default',not exists(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where a.attrelid='public.work_cards'::regclass and a.attname='board_order'),
 'every_card_placed',not exists(select 1 from public.work_cards where board_order is null),
 'made_and_moved_cards_placed',exists(select 1 from pg_trigger where tgrelid='public.work_cards'::regclass and tgname='work_card_place' and tgenabled='O' and (tgtype&2)=2 and (tgtype&4)=4 and (tgtype&16)=16),
 'trigger_private',not has_function_privilege('authenticated','public.work_card_place()','execute'),
 'place_for_members',to_regprocedure('public.place_work_card(uuid,bigint,text,bigint,text)') is null
  and has_function_privilege('authenticated','public.move_card(uuid,bigint,text,bigint,text)','execute')
  and not has_function_privilege('anon','public.move_card(uuid,bigint,text,bigint,text)','execute')
  and not has_function_privilege('service_role','public.move_card(uuid,bigint,text,bigint,text)','execute'),
 'waiting_never_placed',position('waiting is not placed by hand' in pg_get_functiondef('public.check_card_move(uuid,bigint,text)'::regprocedure))>0,
 'editors_place',position('work_can_edit' in pg_get_functiondef('public.check_card_move(uuid,bigint,text)'::regprocedure))>0,
 'ideas_on_top',position('min(w.board_order)' in pg_get_functiondef('public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid)'::regprocedure))>0
);
