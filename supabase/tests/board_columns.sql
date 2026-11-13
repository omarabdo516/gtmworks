begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- A card in each of the nine old stages lands in the column ADR 0013 records.
select set_config('approval.internal','yes',true);
insert into public.work_cards(company_id,stage_id,title) select company_id,id,'column test '||name from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and name<>'خلص';
select set_config('approval.internal','',true);
select is((select string_agg(s.name||'='||s.board_column,',' order by s.position) from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id where w.title like 'column test %'),
 'أفكار=ideas,بريف جاهز=planned,كتابة=progress,تصميم ومونتاج=progress,مراجعة=waiting,معتمد=planned,مجدول للنشر=planned,منشور=live,إعلانات شغالة=live','each old stage has its column');
select is((select count(*)::int from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and board_column='done'),1,'one Done stage');
-- A stage added later is placed by what it is.
insert into public.work_stages(company_id,name,position,kind) values ('10000000-0000-0000-0000-000000000001','تخطيط',0,'before_review'),('10000000-0000-0000-0000-000000000001','متابعة',50,'after_review');
select is((select string_agg(board_column,',' order by position) from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and name in ('تخطيط','متابعة')),'planned,live','a new stage takes a column');
select throws_ok($$update public.work_stages set board_column='waiting' where company_id='10000000-0000-0000-0000-000000000001' and name='تخطيط'$$,'23514',null,'only review is waiting');
delete from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and name in ('تخطيط','متابعة');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
-- The owner moves a card by column; it goes to that column's first stage and the move is logged with both stage names.
select is(public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',(select id from public.work_cards where title='column test أفكار'),'planned'),(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and name='بريف جاهز'),'ideas to planned is the brief stage');
select is((select details->>'new_name' from public.work_activity where card_id=(select id from public.work_cards where title='column test أفكار') and action='card_changed' and details->>'field'='stage_id' order by id desc limit 1),'بريف جاهز','the move is logged');
select is(public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',(select id from public.work_cards where title='column test أفكار'),'planned'),null,'a move inside its own column changes nothing');
-- From a stage after review the same kind is kept: live back to planned is «معتمد», live to done is «خلص».
select is(public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',(select id from public.work_cards where title='column test منشور'),'done'),(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and name='خلص'),'live to done');
select is(public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',(select id from public.work_cards where title='column test إعلانات شغالة'),'planned'),(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and name='معتمد'),'live back to planned keeps the approval');
-- The stage rules still hold: nothing reaches Live without approval, and a decision is needed to leave review.
select throws_ok($$select public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',(select id from public.work_cards where title='column test كتابة'),'live')$$,'P0001','approval required','no approval, no live');
select throws_ok($$select public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',(select id from public.work_cards where title='column test مراجعة'),'progress')$$,'P0001','decision required','waiting is left by deciding');
select throws_ok($$select public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',1,'later')$$,'22023','unknown column','an unknown column is refused');
-- A Viewer cannot move a card; a Contributor cannot move one past review.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',(select id from public.work_cards where title='column test كتابة'),'planned')$$,'P0001','card not found or not permitted','a viewer cannot move');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',(select id from public.work_cards where title='column test مجدول للنشر'),'done')$$,'P0001','contributors cannot move beyond review','a contributor stays before review');
select * from finish();
rollback;
