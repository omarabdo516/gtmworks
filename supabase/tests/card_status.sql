begin;
create extension if not exists pgtap with schema extensions;
select plan(62);
-- #676 (ADR 0026): a Card's status is its column. move_card is the one way a person moves it, and check_card_move holds
-- every rule of a move; until the cutover (#684) the Card keeps its stage too, so the previous release, which reads and
-- writes stages, keeps working: a stage written moves the status, and a status written moves the stage.
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000676','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000676','card-status','Card status','e3821000-0000-4000-8000-000000000676');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000676','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000676','20000000-0000-0000-0000-000000000002','manager'),
 ('10000000-0000-0000-0000-000000000676','20000000-0000-0000-0000-000000000003','contributor'),
 ('10000000-0000-0000-0000-000000000676','20000000-0000-0000-0000-000000000004','viewer');
create temporary table stage_of(name text primary key, id bigint);
insert into stage_of select s.name,s.id from public.work_stages s where s.company_id='10000000-0000-0000-0000-000000000676';
grant select on stage_of to authenticated;
-- The previous release makes a Card by its stage only.
insert into public.work_cards(company_id,stage_id,title) select '10000000-0000-0000-0000-000000000676',(select id from stage_of where name=x.stage),'Status '||x.title
 from (values ('A','كتابة'),('B','تصميم ومونتاج'),('C','كتابة'),('D','كتابة'),('E','كتابة'),('F','كتابة'),('G','كتابة'),('H','كتابة'),('I','أفكار'),('J','بريف جاهز')) x(title,stage) order by x.title;
create temporary view card as select w.title,w.status,s.name as stage,w.board_order from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.company_id='10000000-0000-0000-0000-000000000676';
grant select on card to authenticated;
create function pg_temp.id(t text) returns bigint language sql as $$ select id from public.work_cards where company_id='10000000-0000-0000-0000-000000000676' and title='Status '||t $$;
grant execute on function pg_temp.id(text) to authenticated;

-- Every Card of the seed has the status of its stage's column (the backfill), and a Card made by its stage gets its own.
select is((select count(*)::int from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.status is distinct from s.board_column),0,'every Card''s status is its stage''s column');
select is((select status from card where title='Status B'),'progress','a Card made by its stage takes that stage''s column as its status');
select is((select status from card where title='Status I'),'ideas','a Card made in Ideas is in Ideas');
-- This release makes a Card by its status only, and the Card gets the column's first stage that no approval gives.
insert into public.work_cards(company_id,status,title) values ('10000000-0000-0000-0000-000000000676','planned','Status K'),('10000000-0000-0000-0000-000000000676','progress','Status L');
select is((select stage from card where title='Status K'),'بريف جاهز','a Card made in Planned by its status gets Planned''s first stage that is not an approval''s');
select is((select stage from card where title='Status L'),'كتابة','a Card made In progress by its status gets that column''s first stage');
select throws_ok($$insert into public.work_cards(company_id,status,title) values ('10000000-0000-0000-0000-000000000676','someday','Status X')$$,'23514',null,'a status is one of the six columns');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);

-- A Contributor moves a Card freely, Live and Done included (#668: people who may edit move it freely).
select is(public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('A'),'live'),'progress','a Contributor moves a Card to Live, and the move answers with the column it left');
select is((select status from card where title='Status A'),'live','the Card is Live');
select is((select stage from card where title='Status A'),'منشور','and its stage follows, for the previous release');
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('A'),'done')$$,'a Contributor moves a Live Card to Done');
select is((select stage from card where title='Status A'),'خلص','its stage follows to Done');
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('A'),'planned')$$,'and back from Done to Planned');
select is((select stage from card where title='Status A'),'بريف جاهز','a moved Card lands on the column''s stage no approval gives, never on an approved one');
select is((select count(*)::int from public.work_activity a where a.card_id=pg_temp.id('A') and a.action='approval_approved'),0,'and no move writes an Approval');

-- Every move is logged: who moved it, the two statuses, and the stages for the previous release's log.
select is((select count(*)::int from public.work_activity a where a.card_id=pg_temp.id('A') and a.action='card_changed' and a.actor_id='20000000-0000-0000-0000-000000000003'
 and a.details->>'field'='stage_id' and a.details->>'old_status'='progress' and a.details->>'new_status'='live' and a.details->>'old_name'='كتابة' and a.details->>'new_name'='منشور'),1,'the move to Live has its log row with both statuses and both stages');
select is((select count(*)::int from public.work_activity a where a.card_id=pg_temp.id('A') and a.action='card_changed'),3,'one log row for each of the three moves');
select is((select count(*)::int from public.company_log l where l.card_id=pg_temp.id('A') and l.action='card_changed' and l.details->>'new_status' is not null),3,'and each reaches the Company''s log');
select is((select count(*)::int from public.work_card_moves m where m.card_id=pg_temp.id('A') and m.person_id='20000000-0000-0000-0000-000000000003'
 and m.from_status='done' and m.to_status='planned' and m.from_stage_id=(select id from stage_of where name='خلص') and m.to_stage_id=(select id from stage_of where name='بريف جاهز')),1,'each move is remembered with both statuses and both stages, so either release puts it back');

-- Undo puts back the caller's last move: status, stage and place.
select is(public.undo_card_move('10000000-0000-0000-0000-000000000676',pg_temp.id('A')),'done','Undo answers with the column the Card returned to');
select is((select status||' '||stage from card where title='Status A'),'done خلص','Undo returns the Card to the status and the stage it left');
select is((select count(*)::int from public.work_activity a where a.card_id=pg_temp.id('A') and a.action='card_moved_back' and a.details->>'old_status'='planned' and a.details->>'new_status'='done'),1,'the way back has its own log row');
select throws_ok($$select public.undo_card_move('10000000-0000-0000-0000-000000000676',pg_temp.id('A'))$$,'P0001','the card moved on','the way back is no move of the caller''s to undo again');

-- A place inside a column and above another Card.
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('C'),'planned',pg_temp.id('J'))$$,'a Card is placed in Planned above another');
select ok((select board_order from card where title='Status C')<(select board_order from card where title='Status J'),'it lands above that Card');
select is(public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('C'),'planned',null),null,'a place inside its own column answers no column left');
select ok((select board_order from card where title='Status C')>(select board_order from card where title='Status J'),'and the Card is at the column''s end');
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('C'),'planned',pg_temp.id('B'))$$,'22023','the card it lands above is not in that column','a Card lands only above a Card of the column it goes to');

-- An approved Card moved on and put back returns to its approved stage: Undo restores the stage the move left.
reset role;
select set_config('approval.internal','yes',true);
update public.work_cards set stage_id=(select id from stage_of where name='معتمد') where id=pg_temp.id('D');
select set_config('approval.internal','',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select status from card where title='Status D'),'planned','an approved Card is Planned');
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('D'),'live')$$,'a Contributor moves an approved Card to Live');
select is(public.undo_card_move('10000000-0000-0000-0000-000000000676',pg_temp.id('D')),'planned','and puts it back');
select is((select stage from card where title='Status D'),'معتمد','to its approved stage, not another Planned one');

-- "Waiting on you" is entered only by a question, a review or a failure, and left by the answer.
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('E'),'waiting')$$,'42501','waiting is not placed by hand','no one moves a Card into Waiting on you');
select is((select status from card where title='Status E'),'progress','the Card stays where it was');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.move_work_card('10000000-0000-0000-0000-000000000676',pg_temp.id('E'),(select id from stage_of where name='مراجعة'));
select is((select status from card where title='Status E'),'waiting','a Card the previous release sends to review is Waiting on you');
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('E'),'done')$$,'42501','waiting is not placed by hand','a Card waiting for a review leaves only by the decision');
select lives_ok($$select public.decide_approval('10000000-0000-0000-0000-000000000676',pg_temp.id('E'),'approve')$$,'the Owner approves it');
select is((select status||' '||stage from card where title='Status E'),'planned معتمد','the approved Card is Planned on its approved stage');
select public.move_work_card('10000000-0000-0000-0000-000000000676',pg_temp.id('F'),(select id from stage_of where name='مراجعة'));
select lives_ok($$select public.decide_approval('10000000-0000-0000-0000-000000000676',pg_temp.id('F'),'reject','Fix the caption',true,false)$$,'the Owner sends another back');
select is((select status from card where title='Status F'),'progress','the Card sent back is In progress');
-- A chat's question or handed step puts its Card in Waiting on you while the question waits (#146), and only the answer takes it out.
reset role;
insert into public.conversations(id,company_id,person_id,agent_name) values ('e0000000-0000-0000-0000-000000000676','10000000-0000-0000-0000-000000000676','20000000-0000-0000-0000-000000000003','Lead');
update public.work_cards set conversation_id='e0000000-0000-0000-0000-000000000676' where id=pg_temp.id('G');
insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state)
 values ('10000000-0000-0000-0000-000000000676','e0000000-0000-0000-0000-000000000676','run-676','call-676','hand','Publish the post','{"app":"WordPress","line":"The draft is ready; you press Publish.","rows":[]}','open');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('G'),'planned')$$,'42501','waiting is not placed by hand','a Card its chat holds in Waiting on you is not moved by hand');

-- Who may move: a Viewer never, nor anyone a Card they do not see, an archived Card or another Company's.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('H'),'planned')$$,'42501','not permitted','a Viewer moves no Card');
select throws_ok($$select public.undo_card_move('10000000-0000-0000-0000-000000000676',pg_temp.id('A'))$$,'42501','not permitted','and puts none back');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('H'),'sideways')$$,'22023','unknown column','a status is one of the six columns');
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000099',pg_temp.id('H'),'planned')$$,'42501','not permitted','no one moves a Card in a Company they are not in');
select is((select status from card where title='Status H'),'progress','and the Card stays');
reset role;
update public.work_cards set archived_at=now(),archived_by='20000000-0000-0000-0000-000000000001' where id=pg_temp.id('H');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('H'),'planned')$$,'P0002','card not found or not permitted','an archived Card is not moved');
reset role;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile)
 values ('a0000000-0000-0000-0000-000000000676','10000000-0000-0000-0000-000000000676','c0000000-0000-0000-0000-000000000676','Status Ads','Runs the Meta ads.',false,'card-status-ads');
update public.work_cards set agent_id='a0000000-0000-0000-0000-000000000676' where id=pg_temp.id('B');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('B'),'planned')$$,'P0002','card not found or not permitted','a Card whose Agent is hidden from the Member is not moved, as one that does not exist');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('B'),'planned')$$,'the Owner, who sees every Agent, moves it');

-- Nothing to undo: a Card the caller never moved.
select throws_ok($$select public.undo_card_move('10000000-0000-0000-0000-000000000676',pg_temp.id('I'))$$,'42501','nothing to undo','a Card the caller never moved has nothing to undo');

-- The previous release keeps working on this schema: its stage moves move the status, and its Undo puts back this
-- release's moves (and the other way round), since each move is remembered in both shapes.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.place_work_card('10000000-0000-0000-0000-000000000676',pg_temp.id('I'),'planned',null)$$,'the previous release places a Card in Planned');
select is((select status from card where title='Status I'),'planned','its status follows the stage');
select is(public.undo_card_move('10000000-0000-0000-0000-000000000676',pg_temp.id('I')),'ideas','this release''s Undo puts the previous release''s move back');
select is((select status||' '||stage from card where title='Status I'),'ideas أفكار','to the status and stage it left');
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('I'),'progress')$$,'this release moves the Card');
select is(public.undo_work_card_move('10000000-0000-0000-0000-000000000676',pg_temp.id('I')),'ideas','and the previous release''s Undo puts it back');
select is((select status from card where title='Status I'),'ideas','status and stage agree again');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select lives_ok($$update public.work_cards set stage_id=(select id from stage_of where name='تصميم ومونتاج') where id=pg_temp.id('L')$$,'the previous release moves a Card from one In-progress stage to the other');
select is((select status||' '||stage from card where title='Status L'),'progress تصميم ومونتاج','the status stays In progress');
select throws_ok($$update public.work_cards set stage_id=(select id from stage_of where name='منشور') where id=pg_temp.id('L')$$,'P0001','contributors cannot move beyond review','the previous release''s rules still hold for its own writes');
select throws_ok($$update public.work_cards set status='live' where id=pg_temp.id('L')$$,'P0001','contributors cannot move beyond review','a status written without move_card meets the stage rules, so move_card is the one way past them');
select is((select status from card where title='Status L'),'progress','and the Card stays');

-- Each status is the column the board draws.
select is((select count(*)::int from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.status is distinct from s.board_column),0,'after every move, each Card''s status is its stage''s column');

select * from finish();
rollback;
