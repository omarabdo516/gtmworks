begin;
create extension if not exists pgtap with schema extensions;
select plan(21);
-- #876: a send is checked before any Run starts. The person is an active Member and not a Viewer, the Conversation is
-- theirs, and they may talk to its Agent; a new Conversation's row is written first, on the session id gtmworks chose.
-- RS Learning's Owner (…01), Manager (…02), Contributor (…03) and Viewer (…04).
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a8760000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f8760000-0000-0000-0000-000000000001','Lead','General',true,'default'),
 ('a8760000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f8760000-0000-0000-0000-000000000002','Faye','Marketing',false,'default');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values
 ('c8760000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a8760000-0000-0000-0000-000000000001','Lead','gtmworks-c8760000-0000-0000-0000-000000000009');
update public.companies set engine_conversations=true where id='10000000-0000-0000-0000-000000000001';
insert into public.member_notes(company_id,person_id,note) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Write to me in short lines.'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Omar likes tables.');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.open_engine_conversation('10000000-0000-0000-0000-000000000001','c8760000-0000-0000-0000-000000000001','a8760000-0000-0000-0000-000000000001','gtmworks-c8760000-0000-0000-0000-000000000001','Plan the launch'),
 jsonb_build_object('state','engine','agent','a8760000-0000-0000-0000-000000000001','session','gtmworks-c8760000-0000-0000-0000-000000000001','note','Write to me in short lines.'),
 'a new Conversation is the sender''s, on the session gtmworks chose, with their own note and no one else''s');
select is((select hermes_session_id from public.conversations where id='c8760000-0000-0000-0000-000000000001'),'gtmworks-c8760000-0000-0000-0000-000000000001','its row is written before any Run starts');
select is(public.open_engine_conversation('10000000-0000-0000-0000-000000000001','c8760000-0000-0000-0000-000000000001','a8760000-0000-0000-0000-000000000002','gtmworks-11111111-0000-0000-0000-000000000001','Again')->>'session','gtmworks-c8760000-0000-0000-0000-000000000001','a second send keeps its session and its Agent');
select throws_ok($$select public.hold_conversation_run('c8760000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','run_876_1')$$,'42501',null,'no browser names a Run for the row to hold');
reset role;
select is(public.hold_conversation_run('c8760000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','run_876_1'),true,'the server holds the Run started as the row''s open Run');
set local role authenticated;
select is((select open_run from public.conversations where id='c8760000-0000-0000-0000-000000000001'),'run_876_1','the row holds it');
select is(public.end_conversation_run('c8760000-0000-0000-0000-000000000001','run_876_0'),false,'the end of another Run leaves it');
select is(public.end_conversation_run('c8760000-0000-0000-0000-000000000001','run_876_1'),true,'its own end clears it');
select is((select open_run from public.conversations where id='c8760000-0000-0000-0000-000000000001'),null,'no Run is open once its end is seen');
select throws_ok($$select public.open_engine_conversation('10000000-0000-0000-0000-000000000001','c8760000-0000-0000-0000-000000000002','a8760000-0000-0000-0000-000000000002','gtmworks-c8760000-0000-0000-0000-000000000002','Hi')$$,'P0002',null,'a Member who may not talk to that Agent is refused');
select is((select count(*)::int from public.conversations where id='c8760000-0000-0000-0000-000000000002'),0,'and no row is written for it');
select throws_ok($$select public.open_engine_conversation('10000000-0000-0000-0000-000000000001','c8760000-0000-0000-0000-000000000009','a8760000-0000-0000-0000-000000000001','gtmworks-c8760000-0000-0000-0000-000000000009','Hi')$$,'P0002',null,'another Member''s Conversation is refused');
reset role;
select is(public.hold_conversation_run('c8760000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000002','run_876_2'),false,'nor is a Run held on it for them');
set local role authenticated;
select throws_ok($$select public.open_engine_conversation('10000000-0000-0000-0000-000000000001','c8760000-0000-0000-0000-000000000003','a8760000-0000-0000-0000-000000000001','not-a-session','Hi')$$,'22023',null,'a session id gtmworks did not choose is refused');

reset role;
update public.companies set engine_conversations=false where id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.open_engine_conversation('10000000-0000-0000-0000-000000000001','c8760000-0000-0000-0000-000000000005','a8760000-0000-0000-0000-000000000001','gtmworks-c8760000-0000-0000-0000-000000000005','Hi')->>'state','old','a Company not switched over keeps its new Conversations on the old record');
select is(public.open_engine_conversation('10000000-0000-0000-0000-000000000001','c8760000-0000-0000-0000-000000000001','a8760000-0000-0000-0000-000000000001','gtmworks-c8760000-0000-0000-0000-000000000005','Hi')->>'state','engine','a Conversation already on the Engine stays there');
reset role;
update public.conversations set archived_at=now(),archived_by='20000000-0000-0000-0000-000000000002' where id='c8760000-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.open_engine_conversation('10000000-0000-0000-0000-000000000001','c8760000-0000-0000-0000-000000000001','a8760000-0000-0000-0000-000000000001','gtmworks-c8760000-0000-0000-0000-000000000005','Back again')->>'state','engine','an archived Conversation on the Engine takes a message');
select is((select archived_at from public.conversations where id='c8760000-0000-0000-0000-000000000001'),null,'and writing in it brings it back');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.open_engine_conversation('10000000-0000-0000-0000-000000000001','c8760000-0000-0000-0000-000000000004','a8760000-0000-0000-0000-000000000001','gtmworks-c8760000-0000-0000-0000-000000000004','Hi')$$,'42501',null,'a Viewer is refused');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.open_engine_conversation('10000000-0000-0000-0000-000000000001','c8760000-0000-0000-0000-000000000009','a8760000-0000-0000-0000-000000000001','gtmworks-c8760000-0000-0000-0000-000000000009','Hi')->>'note','Omar likes tables.','each sender has their own note');
reset role;
select ok(not has_function_privilege('anon','public.open_engine_conversation(uuid,uuid,uuid,text,text)','execute'),'nobody signed out may send');
select * from finish();
rollback;
