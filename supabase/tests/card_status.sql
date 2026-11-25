begin;
create extension if not exists pgtap with schema extensions;
select plan(37);
-- #676, #684 (ADR 0026): a Card's status is its column. move_card is the one way a person moves it, with every rule of a
-- move in check_card_move, and undo_card_move puts the person's own latest move back (#168). Since the cutover the Card
-- has no stage, and a status is never written by hand: the row refuses it (card_write_guard).
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000676','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000676','card-status','Card status','e3821000-0000-4000-8000-000000000676');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000676','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000676','20000000-0000-0000-0000-000000000002','manager'),
 ('10000000-0000-0000-0000-000000000676','20000000-0000-0000-0000-000000000003','contributor'),
 ('10000000-0000-0000-0000-000000000676','20000000-0000-0000-0000-000000000004','viewer');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6760000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000676','f6760000-0000-0000-0000-000000000001','SEO','SEO',false,'default');
insert into public.work_cards(company_id,status,title) select '10000000-0000-0000-0000-000000000676',x.status,'Status '||x.title
 from (values ('A','progress'),('B','progress'),('C','planned'),('D','ideas'),('E','progress'),('F','progress'),('G','ideas'),('H','planned')) x(title,status) order by x.title;
insert into public.work_cards(company_id,status,title,agent_id) values ('10000000-0000-0000-0000-000000000676','progress','Status Hidden','a6760000-0000-0000-0000-000000000001');
insert into public.work_cards(company_id,status,title,archived_at) values ('10000000-0000-0000-0000-000000000676','progress','Status Archived',now());
create temporary view card as select w.title,w.status,w.board_order from public.work_cards w where w.company_id='10000000-0000-0000-0000-000000000676';
grant select on card to authenticated;
create function pg_temp.id(t text) returns bigint language sql as $$ select id from public.work_cards where company_id='10000000-0000-0000-0000-000000000676' and title='Status '||t $$;
grant execute on function pg_temp.id(text) to authenticated;
create function pg_temp.answer(call text) returns text language plpgsql as $$ begin execute call; return 'ok'; exception when others then return sqlstate||' '||sqlerrm; end $$;
grant execute on function pg_temp.answer(text) to authenticated;

select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='status' and is_nullable='NO')
 and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='stage_id'),'a Card has a status and no stage');
select throws_ok($$insert into public.work_cards(company_id,status,title) values ('10000000-0000-0000-0000-000000000676','review','Status X')$$,'23514',null,'a status is one of the six columns');

-- Read as the table's owner: the callers below see neither the archived Card, nor the hidden Agent's, nor another Company's.
select set_config('test.b',pg_temp.id('B')::text,true),set_config('test.archived',pg_temp.id('Archived')::text,true),set_config('test.hidden',pg_temp.id('Hidden')::text,true);
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
-- A Contributor moves a Card anywhere but Waiting on you, Live and Done included, each move logged and remembered.
select is(public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('A'),'live'),'progress','a Contributor moves a Card to Live, and the move answers with the column it left');
select is((select status from card where title='Status A'),'live','the Card is Live');
select is(public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('A'),'done'),'live','a Contributor moves a Live Card to Done');
select is(public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('A'),'planned'),'done','and back from Done to Planned');
select is((select string_agg(a.details->>'old_status'||'>'||(a.details->>'new_status'),',' order by a.id) from public.work_activity a
 where a.card_id=pg_temp.id('A') and a.action='card_changed' and a.details->>'field'='status'),'progress>live,live>done,done>planned','one log row for each move, naming both columns');
select is((select string_agg(m.from_status||'>'||m.to_status,',' order by m.id) from public.work_card_moves m where m.card_id=pg_temp.id('A') and m.person_id='20000000-0000-0000-0000-000000000003'),
 'progress>live,live>done,done>planned','each move is remembered by its columns and the person who made it');
select is((select count(*)::int from public.company_log l where l.card_id=pg_temp.id('A') and l.action='card_changed'),3,'and reaches the Company''s log');

-- Undo puts the person's own latest move back, in the column and the place it left, with a log row of its own.
select set_config('test.place',(select board_order::text from card where title='Status A'),true);
select is(public.undo_card_move('10000000-0000-0000-0000-000000000676',pg_temp.id('A')),'done','Undo answers with the column the Card returned to');
select is((select status from card where title='Status A'),'done','the Card is back in Done');
select is((select count(*)::int from public.work_activity a where a.card_id=pg_temp.id('A') and a.action='card_moved_back' and a.details->>'old_column'='planned' and a.details->>'new_column'='done'),1,'the way back has its own log row');
select is(pg_temp.answer(format('select public.undo_card_move(%L,%s)','10000000-0000-0000-0000-000000000676',pg_temp.id('A'))),'P0001 the card moved on','an Undo is used once');
select is(pg_temp.answer(format('select public.undo_card_move(%L,%s)','10000000-0000-0000-0000-000000000676',pg_temp.id('B'))),'42501 nothing to undo','a Card the caller never moved has nothing to undo');
-- A move by someone else since is not undone.
select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('E'),'planned');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('E'),'live');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(pg_temp.answer(format('select public.undo_card_move(%L,%s)','10000000-0000-0000-0000-000000000676',pg_temp.id('E'))),'P0001 the card moved on','a Card moved on by someone else since is not put back');
select is((select status from card where title='Status E'),'live','and stays where they moved it');

-- A place inside a column: above the Card named, or at its end.
select is(public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('F'),'planned',pg_temp.id('C')),'progress','a Card is placed in Planned above another');
select ok((select board_order from card where title='Status F')<(select board_order from card where title='Status C'),'it lands above that Card');
select is(public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('F'),'planned'),null,'a place inside its own column answers no column left');
select ok((select board_order from card where title='Status F')>(select max(board_order) from card where status='planned' and title<>'Status F'),'with no Card named it goes to the column''s end');
select is(pg_temp.answer(format('select public.move_card(%L,%s,%L,%s)','10000000-0000-0000-0000-000000000676',pg_temp.id('F'),'planned',pg_temp.id('D'))),'22023 the card it lands above is not in that column','a Card lands only above a Card of the column it goes to');

-- Waiting on you is reached and left by a review only.
select is(pg_temp.answer(format('select public.move_card(%L,%s,%L)','10000000-0000-0000-0000-000000000676',pg_temp.id('D'),'waiting')),'42501 waiting is not placed by hand','no one moves a Card into Waiting on you');
select is((select status from card where title='Status D'),'ideas','the Card stays where it was');
select lives_ok($$select public.ask_review('10000000-0000-0000-0000-000000000676',pg_temp.id('G'))$$,'a Card is sent to review');
select is((select status from card where title='Status G'),'waiting','and is Waiting on you');
select is(pg_temp.answer(format('select public.move_card(%L,%s,%L)','10000000-0000-0000-0000-000000000676',pg_temp.id('G'),'planned')),'42501 waiting is not placed by hand','a Card waiting for a review leaves only by the decision');

-- The row itself refuses a status or a review written by hand.
select is(pg_temp.answer(format('update public.work_cards set status=%L where id=%s','live',pg_temp.id('H'))),'42501 a card moves with move_card','a status written by hand is refused');
select is(pg_temp.answer(format('update public.work_cards set approved_at=now() where id=%s',pg_temp.id('H'))),'42501 approval fields are protected','an approval written by hand is refused');
select is(pg_temp.answer($$insert into public.work_cards(company_id,status,title) values ('10000000-0000-0000-0000-000000000676','waiting','Status Forged')$$),'42501 waiting is not placed by hand','a Card made by hand is not made waiting on a review');
select is((select status from card where title='Status H'),'planned','and the Card stays');

-- Who may not move: a Viewer, someone outside the Company, and anyone on an archived Card or one whose Agent hides from them.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is(pg_temp.answer(format('select public.move_card(%L,%s,%L)','10000000-0000-0000-0000-000000000676',pg_temp.id('B'),'planned')),'42501 not permitted','a Viewer moves no Card');
select is(pg_temp.answer(format('select public.undo_card_move(%L,%s)','10000000-0000-0000-0000-000000000676',pg_temp.id('A'))),'42501 not permitted','and puts none back');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(pg_temp.answer(format('select public.move_card(%L,%s,%L)','10000000-0000-0000-0000-000000000676',current_setting('test.b'),'planned')),'42501 not permitted','no one moves a Card in a Company they are not in');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(pg_temp.answer(format('select public.move_card(%L,%s,%L)','10000000-0000-0000-0000-000000000676',current_setting('test.archived'),'done')),'P0002 card not found or not permitted','an archived Card is not moved');
select is(pg_temp.answer(format('select public.move_card(%L,%s,%L)','10000000-0000-0000-0000-000000000676',current_setting('test.hidden'),'done')),'P0002 card not found or not permitted','a Card whose Agent is hidden from the Member is not moved, as one that does not exist');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.move_card('10000000-0000-0000-0000-000000000676',pg_temp.id('Hidden'),'done'),'progress','the Owner, who sees every Agent, moves it');
select is((select status from card where title='Status B'),'progress','and every refused move left its Card where it was');
reset role;
select * from finish();
rollback;
