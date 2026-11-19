-- Every Card keeps a place in its column (#174); a Card made or moved to a column without one takes that column's end,
-- a Card a caller inserts without a place included, so the previous app version's calls run as before. Placing is the
-- signed-in person's, through a function that refuses "Waiting on you", a Viewer and a Contributor past review, and the
-- column is additive with no default of its own.
select json_build_object(
 'place_column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='board_order' and data_type='numeric' and is_nullable='NO'),
 'no_default',not exists(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where a.attrelid='public.work_cards'::regclass and a.attname='board_order'),
 'every_card_placed',not exists(select 1 from public.work_cards where board_order is null),
 'made_and_moved_cards_placed',exists(select 1 from pg_trigger where tgrelid='public.work_cards'::regclass and tgname='work_card_place' and tgenabled='O' and (tgtype&2)=2 and (tgtype&4)=4 and (tgtype&16)=16),
 'trigger_private',not has_function_privilege('authenticated','public.work_card_place()','execute'),
 'place_for_members',has_function_privilege('authenticated','public.place_work_card(uuid,bigint,text,bigint,text)','execute')
  and not has_function_privilege('anon','public.place_work_card(uuid,bigint,text,bigint,text)','execute')
  and not has_function_privilege('service_role','public.place_work_card(uuid,bigint,text,bigint,text)','execute'),
 'waiting_never_placed',position('waiting is not placed by hand' in pg_get_functiondef('public.place_work_card(uuid,bigint,text,bigint,text)'::regprocedure))>0,
 'past_review_by_managers',position('can_manage_company' in pg_get_functiondef('public.place_work_card(uuid,bigint,text,bigint,text)'::regprocedure))>0,
 'ideas_on_top',position('min(w.board_order)' in pg_get_functiondef('public.create_work_card(uuid,bigint,text,uuid)'::regprocedure))>0
);
