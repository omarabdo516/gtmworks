begin;
create extension if not exists pgtap with schema extensions;
select plan(28);
-- #882: on a Company switched over to the Engine (engine_conversations), the main Agent opens its Owner's first
-- Conversation once, as on the old record, but writes no message: the row marks it, and its first send gives it its
-- session and tells the Run the opening's names. A send also answers the model chosen for the Conversation, and an
-- Agent whose Engine Conversation holds an open Run is working.
insert into public.company_engines(id,address,key_encrypted) values ('e8820000-0000-4000-8000-000000000001','http://engine:8642','cipher'),('e8820000-0000-4000-8000-000000000002','http://engine-two:8642','cipher');
insert into public.companies(id,slug,name,engine_id,engine_conversations) values ('10000000-0000-0000-0000-000000000882','engine-opening','Opening Co','e8820000-0000-4000-8000-000000000001',true);
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000882','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000882','20000000-0000-0000-0000-000000000002','manager');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile,is_default)
 values('f8820000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000882',gen_random_uuid(),'Lead','General','lead882opening',true);
-- First run made the Owner an empty Conversation with Lead.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c8820000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000882','20000000-0000-0000-0000-000000000001','f8820000-0000-0000-0000-000000000001','Lead');

set local role service_role;
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000882','20000000-0000-0000-0000-000000000002','c8820000-0000-0000-0000-000000000009','Hi'),null::uuid,
 'a Manager is never given the opening');
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000882','20000000-0000-0000-0000-000000000001','c8820000-0000-0000-0000-000000000002','Hi'),'c8820000-0000-0000-0000-000000000001'::uuid,
 'the Owner''s empty Conversation with Lead is the one opened');
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000882','20000000-0000-0000-0000-000000000001','c8820000-0000-0000-0000-000000000003','Hi'),'c8820000-0000-0000-0000-000000000001'::uuid,
 'a second visit before anyone writes goes back to it');
reset role;
select is((select count(*)::int from public.conversations where company_id='10000000-0000-0000-0000-000000000882'),1,'no second Conversation is made');
select is((select lead_opening from public.conversations where id='c8820000-0000-0000-0000-000000000001'),true,'its row says the main Agent opened it');
select is((select count(*)::int from public.conversation_messages where company_id='10000000-0000-0000-0000-000000000882'),0,'and no message is written: the opening is gtmworks''s own words');
select is((select hermes_session_id from public.conversations where id='c8820000-0000-0000-0000-000000000001'),null,'it has no session before the Owner answers');

-- The Owner chose a model for it, then answers.
update public.people set language='en' where id='20000000-0000-0000-0000-000000000001';
update public.conversations set model='{"provider":"openrouter","model":"anthropic/claude-sonnet"}' where id='c8820000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
create temporary table answered as select public.open_engine_conversation('10000000-0000-0000-0000-000000000882','c8820000-0000-0000-0000-000000000001',null,'We sell courses') as answer;
select is((select answer->>'state' from answered),'engine','the answer goes to the Engine');
select matches((select answer->>'session' from answered),'^gtmworks-[0-9a-f-]{36}$','on a session the database chose for it now');
select is((select answer->'opening' from answered),jsonb_build_object('owner','عمر','language','en','lead','Lead','company','Opening Co'),'with the names and the language its opening is said in');
select is((select answer->'model' from answered),'{"provider":"openrouter","model":"anthropic/claude-sonnet"}'::jsonb,'and the model chosen for it');
select is(public.open_engine_conversation('10000000-0000-0000-0000-000000000882','c8820000-0000-0000-0000-000000000001',null,'And more')->>'session',(select answer->>'session' from answered),'a later send keeps that session');
reset role;
select is((select hermes_session_id from public.conversations where id='c8820000-0000-0000-0000-000000000001'),(select answer->>'session' from answered),'the row holds it');

set local role service_role;
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000882','20000000-0000-0000-0000-000000000001','c8820000-0000-0000-0000-000000000004','Hi'),null::uuid,
 'once the Owner answered, a visit finds nothing to open or go back to');
reset role;

-- A model the Engine refused takes the Conversation back to the one it had, for its own person only.
update public.conversations set model_before='{"provider":"anthropic","model":"claude-opus"}' where id='c8820000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.refuse_conversation_model('10000000-0000-0000-0000-000000000882','c8820000-0000-0000-0000-000000000001','{"provider":"openrouter","model":"anthropic/claude-sonnet"}'),false,'another Member cannot');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.refuse_conversation_model('10000000-0000-0000-0000-000000000882','c8820000-0000-0000-0000-000000000001','{"provider":"openrouter","model":"anthropic/claude-sonnet"}'),true,'its person can');
reset role;
select is((select model from public.conversations where id='c8820000-0000-0000-0000-000000000001'),'{"provider":"anthropic","model":"claude-opus"}'::jsonb,'and it is on the model it had');

-- A Company switched over where someone wrote first is never opened.
select set_config('request.jwt.claim.sub','',true);
insert into public.companies(id,slug,name,engine_id,engine_conversations) values ('10000000-0000-0000-0000-000000000883','engine-written','Written','e8820000-0000-4000-8000-000000000002',true);
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000883','20000000-0000-0000-0000-000000000001','owner');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile,is_default)
 values('f8830000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000883',gen_random_uuid(),'Lead','General','lead883',true);
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values
 ('c8830000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000883','20000000-0000-0000-0000-000000000001','f8830000-0000-0000-0000-000000000001','Lead','gtmworks-c8830000-0000-0000-0000-000000000001');
set local role service_role;
select is(public.open_first_conversation('10000000-0000-0000-0000-000000000883','20000000-0000-0000-0000-000000000001','c8830000-0000-0000-0000-000000000002','Hi'),null::uuid,
 'a Company with a Conversation on the Engine already is never opened');
reset role;

-- Any other Engine Conversation answers no opening, and the model chosen for it (none here).
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.open_engine_conversation('10000000-0000-0000-0000-000000000883','c8830000-0000-0000-0000-000000000001',null,'Hi')-'session',
 jsonb_build_object('state','engine','agent','f8830000-0000-0000-0000-000000000001','note',null,'model',null,'model_before',null),'a Conversation Lead did not open is told no opening');

-- The face: a Run the Engine Conversation's row holds sets its Agent working, for every Member who sees the Agent.
reset role;
update public.conversations set open_runs=array['run_882_1'],last_message_at=now() where id='c8820000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select state from public.agent_face_states('10000000-0000-0000-0000-000000000882') where agent='f8820000-0000-0000-0000-000000000001'),'working',
 'an Agent whose Engine Conversation holds an open Run is working');
select throws_ok($$select * from public.held_conversation_runs()$$,'42501',null,'no browser lists the held Runs');
select throws_ok($$select public.let_go_conversation_run('c8820000-0000-0000-0000-000000000001','run_882_1',false)$$,'42501',null,'nor lets go of one');
reset role;
set local role service_role;
select is((select runs from public.held_conversation_runs() where conversation='c8820000-0000-0000-0000-000000000001'),array['run_882_1'],'the worker lists the Run the row holds, with its Agent''s profile');
select is(public.let_go_conversation_run('c8820000-0000-0000-0000-000000000001','run_882_1',true),true,'and lets go of it once the Engine says it ended');
reset role;
select is((select unseen_run from public.conversations where id='c8820000-0000-0000-0000-000000000001'),'run_882_1','one that did not finish stays as the unseen Run, for its person''s next open to say why');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.end_conversation_run('c8820000-0000-0000-0000-000000000001','run_882_1'),true,'its person''s open reads its end');
reset role;
select is((select unseen_run from public.conversations where id='c8820000-0000-0000-0000-000000000001'),null,'and lets it go');
set local role authenticated;
select is((select state from public.agent_face_states('10000000-0000-0000-0000-000000000882') where agent='f8820000-0000-0000-0000-000000000001'),'idle',
 'and idle once its end is seen');
select * from finish();
rollback;
