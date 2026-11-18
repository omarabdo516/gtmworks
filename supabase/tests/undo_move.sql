begin;
create extension if not exists pgtap with schema extensions;
select plan(45);
-- A Company of its own, with the ten stages a new one receives (ADR 0013): «كتابة» and «تصميم ومونتاج» are both In
-- progress, and «بريف جاهز» is Planned, so a Card's stage and its column are told apart.
insert into public.companies(id,slug,name) values ('10000000-0000-0000-0000-000000000097','undo-move','Undo move');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000097','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000097','20000000-0000-0000-0000-000000000002','manager'),
 ('10000000-0000-0000-0000-000000000097','20000000-0000-0000-0000-000000000003','contributor'),
 ('10000000-0000-0000-0000-000000000097','20000000-0000-0000-0000-000000000004','viewer');
insert into public.work_cards(company_id,stage_id,title) select '10000000-0000-0000-0000-000000000097',s.id,'Undo '||x.title
 from (values ('A','كتابة'),('B','تصميم ومونتاج'),('C','كتابة'),('D','كتابة'),('E','كتابة'),('F','كتابة'),('G','كتابة'),('H','كتابة'),('I','كتابة'),('K','كتابة')) x(title,stage)
 join public.work_stages s on s.company_id='10000000-0000-0000-0000-000000000097' and s.name=x.stage order by x.title;
-- A Card after review, as an approval leaves one.
select set_config('approval.internal','yes',true);
insert into public.work_cards(company_id,stage_id,title) select '10000000-0000-0000-0000-000000000097',s.id,'Undo J'
 from public.work_stages s where s.company_id='10000000-0000-0000-0000-000000000097' and s.name='منشور';
select set_config('approval.internal','',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

-- A board move of a Card from the first In-progress stage to Planned is remembered with both stages and both places,
-- and "Undo" puts the Card back in the stage it left and in the place it held, with one row for each way.
select lives_ok($$select public.place_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo A'),'planned',null)$$,'a Card is placed in Planned');
select is((select count(*)::int from public.work_card_moves m where m.card_id=(select id from public.work_cards where title='Undo A') and m.person_id='20000000-0000-0000-0000-000000000001'
 and (select name from public.work_stages where id=m.from_stage_id)='كتابة' and (select name from public.work_stages where id=m.to_stage_id)='بريف جاهز'
 and m.from_place=1 and m.to_place=1),1,'the move is remembered with the stage and place it left and the ones it arrived at');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Undo A'),'بريف جاهز','the Card is in Planned');
select is(public.undo_work_card_move('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo A')),'progress','Undo answers with the column it returned to');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Undo A'),'كتابة','Undo returns the Card to the stage it left');
select is((select board_order from public.work_cards where title='Undo A'),1::numeric,'Undo returns the Card to the place it held');
select is((select count(*)::int from public.work_activity a where a.card_id=(select id from public.work_cards where title='Undo A') and a.action='card_changed'
 and a.actor_id='20000000-0000-0000-0000-000000000001' and a.details->>'old_name'='كتابة' and a.details->>'new_name'='بريف جاهز'),1,'the move has one row, naming who moved it and both stages');
select is((select count(*)::int from public.work_activity a where a.card_id=(select id from public.work_cards where title='Undo A') and a.action='card_moved_back'
 and a.actor_id='20000000-0000-0000-0000-000000000001' and a.details->>'old_name'='بريف جاهز' and a.details->>'new_name'='كتابة'),1,'the way back has one row of its own, naming who made it and both stages');
select is((select count(*)::int from public.work_activity a where a.card_id=(select id from public.work_cards where title='Undo A') and a.action in ('card_changed','card_moved_back')),2,'two rows in all: the move and the way back');
select is((select count(*)::int from public.work_activity a where a.card_id=(select id from public.work_cards where title='Undo A') and a.details->>'field'='board_order'),0,'a place inside one column is still no log row');

-- «In progress» holds two stages: a Card that left «تصميم ومونتاج» returns there, not to «كتابة».
select lives_ok($$select public.place_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo B'),'planned',null)$$,'a Card of the second In-progress stage is placed in Planned');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Undo B'),'بريف جاهز','the Card of the second In-progress stage is in Planned');
select is(public.undo_work_card_move('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo B')),'progress','Undo answers with In progress');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Undo B'),'تصميم ومونتاج','Undo returns the Card to the second In-progress stage, not the first');
select is((select board_order from public.work_cards where title='Undo B'),2::numeric,'the Card of the second stage returns to its own place');

-- Only the caller's last move of the Card is undone.
select lives_ok($$select public.place_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo C'),'planned',null)$$,'a Card is moved twice: to Planned');
select lives_ok($$select public.place_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo C'),'progress',null)$$,'a Card is moved twice: on to In progress');
select is(public.undo_work_card_move('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo C')),'planned','Undo undoes the last move only');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Undo C'),'بريف جاهز','the Card waits in Planned again, not in the first stage');

-- A Card someone else moved meanwhile is not put back.
select lives_ok($$select public.place_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo D'),'planned',null)$$,'the Owner places a Card in Planned');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.move_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo D'),(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000097' and name='تصميم ومونتاج'));
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.undo_work_card_move('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo D'))$$,'P0001','the card moved on','a Card someone else moved is not put back');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Undo D'),'تصميم ومونتاج','the Card stays where the other move left it');

-- A Card a decision moved meanwhile is not put back either.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.place_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo E'),'planned',null)$$,'a Manager places a Card in Planned');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.move_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo E'),(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000097' and kind='review'));
select lives_ok($$select public.decide_approval('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo E'),'approve')$$,'the Owner approves the Card');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.undo_work_card_move('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo E'))$$,'P0001','the card moved on','a Card a decision moved is not put back');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Undo E'),'معتمد','the decided Card stays where the decision left it');

-- Nobody undoes another person's move.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.place_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo F'),'planned',null)$$,'the Owner places another Card in Planned');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.undo_work_card_move('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo F'))$$,'42501','nothing to undo','a Manager undoes no move of the Owner''s');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Undo F'),'بريف جاهز','the other person''s Card stays where its mover left it');

-- A Viewer moves nothing and puts nothing back.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.place_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo G'),'planned',null)$$,'the Owner places a further Card in Planned');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.undo_work_card_move('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo G'))$$,'42501','not permitted','a Viewer puts no Card back');

-- A Contributor puts their own move back before review, to the stage it left.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select lives_ok($$select public.place_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo H'),'planned',null)$$,'a Contributor places a Card in Planned');
select is(public.undo_work_card_move('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo H')),'progress','a Contributor puts their own move back');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Undo H'),'كتابة','a Contributor''s Card returns to the stage it left');

-- A Card waiting for a decision is left by deciding, never by putting a move back.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.move_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo I'),(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000097' and kind='review'));
select throws_ok($$select public.undo_work_card_move('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo I'))$$,'42501','waiting is not placed by hand','a Card waiting for a decision is not put back');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Undo I'),'مراجعة','the Card stays in review for its decision');

-- A Contributor puts no Card back after review. Only the people who manage the Company move a Card there, so the record
-- of such a move by a Contributor is written as the database would have it, and the rule is asked anyway.
reset role;
insert into public.work_card_moves(company_id,card_id,person_id,from_stage_id,from_place,to_stage_id,to_place)
 select '10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo J'),'20000000-0000-0000-0000-000000000003',
  (select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000097' and name='كتابة'),
  (select board_order from public.work_cards where title='Undo K'),
  (select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000097' and name='منشور'),
  (select board_order from public.work_cards where title='Undo J');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.undo_work_card_move('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo J'))$$,'42501','not permitted','a Contributor puts no Card back after review');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Undo J'),'منشور','the Card after review stays put');

-- A move by the card's sheet is remembered as a board move is, with the place it arrived at.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.move_work_card('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo K'),(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000097' and name='بريف جاهز'));
select is((select count(*)::int from public.work_card_moves m where m.card_id=(select id from public.work_cards where title='Undo K') and m.person_id='20000000-0000-0000-0000-000000000001'
 and (select name from public.work_stages where id=m.to_stage_id)='بريف جاهز' and m.to_place=(select board_order from public.work_cards where title='Undo K')),1,'a move by the card''s sheet is remembered with the place it arrived at');
select is(public.undo_work_card_move('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo K')),'progress','a move by the card''s sheet is put back too');

-- No Member writes a move record, and a Member of another Company puts nothing back.
select throws_ok($$insert into public.work_card_moves(company_id,card_id,from_stage_id,to_stage_id) values ('10000000-0000-0000-0000-000000000097',(select id from public.work_cards where title='Undo A'),1,2)$$,'42501','permission denied for table work_card_moves','a Member writes no move record of their own');
select isnt((select count(*)::int from public.work_card_moves where company_id='10000000-0000-0000-0000-000000000097'),0,'a Member reads their own moves');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.work_card_moves where company_id='10000000-0000-0000-0000-000000000097' and person_id='20000000-0000-0000-0000-000000000001'),0,'and not another Member''s');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.undo_work_card_move('10000000-0000-0000-0000-000000000099',(select id from public.work_cards where title='Undo A'))$$,'42501','not permitted','a Member puts no Card back in another Company');
select is((select count(*)::int from public.work_card_moves where company_id='10000000-0000-0000-0000-000000000099'),0,'another Company''s moves are neither read nor written');
select * from finish();
rollback;
