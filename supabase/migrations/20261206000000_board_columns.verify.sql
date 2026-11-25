-- The board's six columns are a Card's status since #676; the Card cutover (#684) took the stages they were mapped from
-- away. Every Card is in one of the six, and a signed-in Member moves it with move_card.
select json_build_object(
 'stages_gone',to_regclass('public.work_stages') is null and to_regprocedure('public.work_stage_column(uuid,text,text,integer)') is null
  and to_regprocedure('public.move_work_card_to_column(uuid,bigint,text,text)') is null,
 'every_card_in_a_column',not exists(select 1 from public.work_cards where status not in ('ideas','planned','progress','waiting','live','done')),
 'column_required',exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='status' and is_nullable='NO')
  and exists(select 1 from pg_constraint where conrelid='public.work_cards'::regclass and conname='work_cards_status_known'),
 'move_by_column',has_function_privilege('authenticated','public.move_card(uuid,bigint,text,bigint,text)','execute')
  and not has_function_privilege('anon','public.move_card(uuid,bigint,text,bigint,text)','execute')
);
