begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
-- #679 (spec #668, ADR 0026): a Card's description is Markdown with a version number. Its to-do items are read in order,
-- never inside fenced code; ticking one is its own operation on one item, safe when the text changed meanwhile, and one
-- quiet Activity row. Unticked items never stop a Card from being finished.
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000679','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000679','card-description','Card description','e3821000-0000-4000-8000-000000000679');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000679','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000679','20000000-0000-0000-0000-000000000003','contributor'),
 ('10000000-0000-0000-0000-000000000679','20000000-0000-0000-0000-000000000004','viewer');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6790000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000679','f6790000-0000-0000-0000-000000000001','Main','Main',true,'default'),
 ('a6790000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000679','f6790000-0000-0000-0000-000000000002','SEO','SEO',false,'default');
insert into public.work_cards(company_id,status,title,description,assignee_agent) values
 ('10000000-0000-0000-0000-000000000679','progress','Desc brief',E'# Brief\n\n- [ ] Write the hook\n- [x] Pick the format\n  - [ ] Nested step\n\n```\n- [ ] not an item\n```\n\n1. [ ] Numbered item\n> - [ ] Quoted item',null),
 ('10000000-0000-0000-0000-000000000679','progress','Desc hidden',E'- [ ] Secret step',
  'a6790000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000679','ideas','Desc gone',E'- [ ] Old step',null),
 ('10000000-0000-0000-0000-000000000679','progress','Desc twice',E'- [ ] Same\n- [ ] Same',null);
update public.work_cards set archived_at=now(),archived_by='20000000-0000-0000-0000-000000000001' where title='Desc gone';
create function pg_temp.id(t text) returns bigint language sql as $$ select id from public.work_cards where company_id='10000000-0000-0000-0000-000000000679' and title='Desc '||t $$;
grant execute on function pg_temp.id(text) to authenticated;
create function pg_temp.tick(card text,line integer,item text,done boolean) returns jsonb language sql as $$
 select public.tick_card_todo('10000000-0000-0000-0000-000000000679',pg_temp.id(card),line,item,done) $$;
grant execute on function pg_temp.tick(text,integer,text,boolean) to authenticated;
create temporary view card as select w.title,w.description,w.description_version version from public.work_cards w where w.company_id='10000000-0000-0000-0000-000000000679';
grant select on card to authenticated;
create function pg_temp.ticks(card text) returns integer language sql as $$
 select count(*)::int from public.work_activity a where a.card_id=pg_temp.id(card) and a.action='todo_ticked' $$;
grant execute on function pg_temp.ticks(text) to authenticated;

-- The items, in reading order, never inside a fence.
select results_eq($$select line,item,done from public.card_todos((select description from card where title='Desc brief'))$$,
 $$values (3,'Write the hook',false),(4,'Pick the format',true),(5,'Nested step',false),(11,'Numbered item',false),(12,'Quoted item',false)$$,
 'the to-do items are read in order with their lines, nested, numbered and quoted ones too, and none inside code');
select is((select count(*)::int from public.card_todos(E'~~~~\n- [ ] in\n~~~\n- [ ] still in\n~~~~\n- [ ] out')),1,'a fence closes only on a fence as long');
select is((select count(*)::int from public.card_todos('')),0,'an empty description has none');
select is((select count(*)::int from public.card_todos(E'- [] nope\n-[ ] nope\n- [ ]tight')),0,'a box not written as Markdown''s is no item');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);

-- A tick as the Contributor read it.
select is(pg_temp.tick('brief',3,'Write the hook',true),'{"line": 3, "changed": true, "version": 1}'::jsonb,'a Contributor ticks the item they read');
select is((select split_part(description,E'\n',3) from card where title='Desc brief'),'- [x] Write the hook','the box is ticked in the text');
select is((select version from card where title='Desc brief'),1,'and the description has a new version');
select is(pg_temp.ticks('brief'),1,'one Activity row');
select is((select a.details from public.work_activity a where a.card_id=pg_temp.id('brief') and a.action='todo_ticked'),'{"done": true, "item": "Write the hook"}'::jsonb,'naming the item and its state');

-- The same tick again changes nothing.
select is(pg_temp.tick('brief',3,'Write the hook',true),'{"line": 3, "changed": false, "version": 1}'::jsonb,'a tick already so changes nothing');
select is(pg_temp.ticks('brief'),1,'and logs nothing');

-- Unticking, nested and quoted.
select is(pg_temp.tick('brief',4,'Pick the format',false)->>'changed','true','an item is unticked');
select is((select split_part(description,E'\n',4) from card where title='Desc brief'),'- [ ] Pick the format','its box is empty');
select is(pg_temp.tick('brief',12,'Quoted item',true)->>'changed','true','a quoted item is ticked');
select is((select split_part(description,E'\n',12) from card where title='Desc brief'),'> - [x] Quoted item','inside its quote');

-- The text changed meanwhile: two lines written above the item.
update public.work_cards set description=E'Intro\nMore\n'||description where id=pg_temp.id('brief');
select is(pg_temp.tick('brief',5,'Nested step',true),'{"line": 7, "changed": true, "version": 4}'::jsonb,'a tick of an item that moved finds it by its text');
select is((select split_part(description,E'\n',7) from card where title='Desc brief'),'  - [x] Nested step','and ticks it where it now is');
select throws_ok($$select pg_temp.tick('brief',3,'Write the headline',true)$$,'P0001','to-do changed','an item whose text is gone is refused');
select throws_ok($$select pg_temp.tick('twice',9,'Same',true)$$,'P0001','to-do changed','an item that moved and is now twice is refused');
select is(pg_temp.tick('twice',2,'Same',true)->>'line','2','the one on its own line is ticked');

select throws_ok($$select pg_temp.tick('hidden',1,'Secret step',true)$$,'P0002','card not found or not permitted','a Card whose Agent is hidden from them is not ticked');
select throws_ok($$select public.tick_card_todo('10000000-0000-0000-0000-000000000679',pg_temp.id('gone'),1,'Old step',true)$$,'P0002','card not found or not permitted','an archived Card is not ticked');

-- A Viewer reads it and ticks nothing.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select pg_temp.tick('brief',6,'Write the hook',false)$$,'42501','not permitted','a Viewer ticks nothing');

-- Unticked items never stop a Card from being finished.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.move_card('10000000-0000-0000-0000-000000000679',pg_temp.id('twice'),'done'),'progress','a Card with an unticked item moves to Done');

select * from finish();
rollback;
