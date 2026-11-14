-- A card in each of the nine old stages, as each default Company has them (kind, key, position), lands in the column
-- the ADR records; every card already on a board shows in its stage's column; the Done stage exists once per Company.
with seeded(stage_name,stage_kind,key,stage_position,expected) as (values
 ('أفكار','ideas',null,1,'ideas'),
 ('بريف جاهز','before_review',null,2,'planned'),
 ('كتابة','before_review','writing',3,'progress'),
 ('تصميم ومونتاج','before_review','design',4,'progress'),
 ('مراجعة','review',null,5,'waiting'),
 ('معتمد','after_review','approved',6,'planned'),
 ('مجدول للنشر','after_review','scheduled',7,'planned'),
 ('منشور','after_review',null,8,'live'),
 ('إعلانات شغالة','after_review',null,9,'live')
), company as (select c.id from public.companies c where exists(select 1 from public.work_stages s where s.company_id=c.id and s.stage_key='writing' and s.position=3) limit 1)
select json_build_object(
 'seeded_cards_land_by_mapping',(select bool_and(public.work_stage_column((select id from company),stage_kind,key,stage_position)=expected) from seeded),
 'default_stages_mapped',not exists(select 1 from public.work_stages s join seeded x on x.stage_name=s.name and x.stage_kind=s.kind where s.board_column<>x.expected),
 'every_card_in_a_column',not exists(select 1 from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id where s.board_column is null),
 'done_once_per_company',not exists(select 1 from public.companies c where (select count(*) from public.work_stages s where s.company_id=c.id and s.board_column='done')<>1),
 'column_required',exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_stages' and column_name='board_column' and is_nullable='NO'),
 'waiting_is_review',exists(select 1 from pg_constraint where conrelid='public.work_stages'::regclass and conname='work_stages_waiting_is_review'),
 'new_stage_placed',exists(select 1 from pg_trigger where tgrelid='public.work_stages'::regclass and tgname='work_stage_place' and tgenabled='O'),
 'new_company_has_done',position('خلص' in pg_get_functiondef('public.work_defaults()'::regprocedure))>0,
 'move_by_column',has_function_privilege('authenticated','public.move_work_card_to_column(uuid,bigint,text,text)','execute')
  and not has_function_privilege('anon','public.move_work_card_to_column(uuid,bigint,text,text)','execute')
);
