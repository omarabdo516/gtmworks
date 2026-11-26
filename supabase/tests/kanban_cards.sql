begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
-- Spec #831 (#836): gtmworks keeps one small row beside a Card on the Engine's Kanban board, only when it has something to
-- hold: the Company, the Engine's task id, the Member who is its Assignee, its publishing date and the person who made it
-- (ADR 0004: a Company on the row, its policies by Role). RS Learning: Omar (1) Owner, 2 Manager, 3 and 5 Contributors,
-- 4 Viewer; Aleem: Omar Owner and 5 Contributor. Manager 2 is a Member of RS Learning only.
insert into public.kanban_cards(company_id,task_id,assignee,publish_on,made_by) values
 ('10000000-0000-0000-0000-000000000003','t_aleem001','20000000-0000-0000-0000-000000000005','2026-12-01','20000000-0000-0000-0000-000000000001');
set local role authenticated;

-- A Contributor makes the row of a Card they made, given to a Member, with its publishing date.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select lives_ok($$insert into public.kanban_cards(company_id,task_id,assignee,publish_on,made_by) values ('10000000-0000-0000-0000-000000000001','t_rs000001','20000000-0000-0000-0000-000000000002','2026-12-24','20000000-0000-0000-0000-000000000003')$$,'a Contributor keeps the Card they made, given to a Member');
select lives_ok($$insert into public.kanban_cards(company_id,task_id,made_by) values ('10000000-0000-0000-0000-000000000001','t_rs000002','20000000-0000-0000-0000-000000000003')$$,'and one given to nobody, which holds who made it');
select throws_ok($$insert into public.kanban_cards(company_id,task_id,made_by) values ('10000000-0000-0000-0000-000000000001','t_rs000003','20000000-0000-0000-0000-000000000001')$$,'42501',null,'nobody keeps a Card as made by someone else');
select throws_ok($$insert into public.kanban_cards(company_id,task_id,assignee) values ('10000000-0000-0000-0000-000000000001','t_rs000004','20000000-0000-0000-0000-000000000099')$$,'42501',null,'the Assignee is a Member of the Company');
select throws_ok($$insert into public.kanban_cards(company_id,task_id,assignee) values ('10000000-0000-0000-0000-000000000001','../etc','20000000-0000-0000-0000-000000000002')$$,'23514',null,'a task id is the Engine''s, never a path');
-- The Assignee changes hands; who made the Card does not.
select lives_ok($$update public.kanban_cards set assignee='20000000-0000-0000-0000-000000000005' where task_id='t_rs000001'$$,'a Contributor gives the Card to another Member');
select is((select assignee::text from public.kanban_cards where task_id='t_rs000001'),'20000000-0000-0000-0000-000000000005','and it is theirs now');
select throws_ok($$update public.kanban_cards set made_by='20000000-0000-0000-0000-000000000005' where task_id='t_rs000001'$$,'42501',null,'who made the Card is not rewritten');
select throws_ok($$update public.kanban_cards set assignee='20000000-0000-0000-0000-000000000099' where task_id='t_rs000001'$$,'42501',null,'nor given to someone who is no Member');
select throws_ok($$delete from public.kanban_cards where task_id='t_rs000002'$$,'42501',null,'a Member removes no row: only the slow drift check does');

-- A Manager and an Owner keep a Card too.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$insert into public.kanban_cards(company_id,task_id,made_by) values ('10000000-0000-0000-0000-000000000001','t_rs000005','20000000-0000-0000-0000-000000000002')$$,'a Manager keeps a Card');
-- A Member of another Company reads and writes no row of Aleem's.
select is((select count(*)::int from public.kanban_cards where company_id='10000000-0000-0000-0000-000000000003'),0,'a Member of another Company reads no row of it');
select throws_ok($$insert into public.kanban_cards(company_id,task_id,made_by) values ('10000000-0000-0000-0000-000000000003','t_aleem002','20000000-0000-0000-0000-000000000002')$$,'42501',null,'nor writes one');
update public.kanban_cards set assignee=null where company_id='10000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select assignee::text from public.kanban_cards where task_id='t_aleem001'),'20000000-0000-0000-0000-000000000005','nor changes one');

-- A Viewer reads the rows of their Company and writes none.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.kanban_cards),3,'a Viewer reads their Company''s rows');
select throws_ok($$insert into public.kanban_cards(company_id,task_id,made_by) values ('10000000-0000-0000-0000-000000000001','t_rs000006','20000000-0000-0000-0000-000000000004')$$,'42501',null,'a Viewer keeps no Card');
update public.kanban_cards set assignee='20000000-0000-0000-0000-000000000004',publish_on='2027-01-01' where task_id='t_rs000001';
select is((select assignee::text||' '||publish_on from public.kanban_cards where task_id='t_rs000001'),'20000000-0000-0000-0000-000000000005 2026-12-24','a Viewer changes none');

-- The slow drift check is the worker's alone: it lists each Company's rows and forgets those whose task is gone.
select ok(not has_function_privilege('authenticated','public.kanban_card_tasks()','execute') and not has_function_privilege('anon','public.kanban_card_tasks()','execute'),'no person lists the rows for the drift check');
select ok(not has_function_privilege('authenticated','public.forget_kanban_cards(uuid,text[])','execute'),'nor forgets one');
reset role;
select is((select tasks from public.kanban_card_tasks() where company_id='10000000-0000-0000-0000-000000000001'),array['t_rs000001','t_rs000002','t_rs000005'],'the worker lists a Company''s rows by task id');
select is(public.forget_kanban_cards('10000000-0000-0000-0000-000000000001',array['t_rs000002','t_aleem001']),1,'and forgets the ones it names of that Company only');
select is((select count(*)::int from public.kanban_cards),3,'every other row stays');
select * from finish();
rollback;
