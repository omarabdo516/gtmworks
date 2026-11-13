begin;
create extension if not exists pgtap with schema extensions;
select plan(21);
-- An Owner or Manager signed in makes a stage that takes its column, and cannot show a stage before review as Live or
-- Done, by changing its column or by making it there (the column is guarded like the stage's kind and key). First in
-- the file: PL/pgSQL checks a function's grant once per transaction, so a signed-in insert after one made as the owner
-- would not show a missing grant.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into public.work_stages(company_id,name,position,kind) values ('10000000-0000-0000-0000-000000000001','تخطيط المدير',0,'before_review');
select is((select board_column from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and name='تخطيط المدير'),'planned','a signed-in Manager makes a stage and it is placed');
select throws_ok($$update public.work_stages set board_column='done' where company_id='10000000-0000-0000-0000-000000000001' and name='كتابة'$$,'P0001','stage identity cannot change','a Manager cannot move writing to Done');
select throws_ok($$update public.work_stages set board_column='live' where company_id='10000000-0000-0000-0000-000000000001' and name='بريف جاهز'$$,'P0001','stage identity cannot change','a Manager cannot move the brief stage to Live');
select throws_ok($$insert into public.work_stages(company_id,name,position,kind,board_column) values ('10000000-0000-0000-0000-000000000001','مباشر مبكر',2,'before_review','live')$$,'P0001','a stage before review cannot be live or done','a Manager cannot make a stage before review in Live');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$insert into public.work_stages(company_id,name,position,kind,board_column) values ('10000000-0000-0000-0000-000000000001','خلص مبكر',2,'before_review','done')$$,'P0001','a stage before review cannot be live or done','an Owner cannot make a stage before review in Done');
select is((select string_agg(name||'='||board_column,',' order by position) from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and name in ('بريف جاهز','كتابة')),'بريف جاهز=planned,كتابة=progress','the stages keep their columns');
reset role;
delete from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and name='تخطيط المدير';

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
-- Only review is waiting: a stage made in Waiting on you is refused by the constraint, and a stage's column never changes.
select throws_ok($$insert into public.work_stages(company_id,name,position,kind,board_column) values ('10000000-0000-0000-0000-000000000001','انتظار',60,'before_review','waiting')$$,'23514',null,'only review is waiting');
select throws_ok($$update public.work_stages set board_column='waiting' where company_id='10000000-0000-0000-0000-000000000001' and name='تخطيط'$$,'P0001','stage identity cannot change','a stage keeps its column');
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
