begin;
create extension if not exists pgtap with schema extensions;
select plan(33);
-- RS Learning: Omar (1) is Owner, 2 Manager (مدير), 3 and 5 Contributors, 4 Viewer.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('e0000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','team','ciphertext','connected');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('e1000000-0000-0000-0000-000000000211','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000211','Mona','Writing',false);
set local role authenticated;

-- (g) A Member's note: saved as themselves, read by nobody else, refused when too long or secret-looking.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.save_member_note('10000000-0000-0000-0000-000000000001','Answer in short points.'),'Answer in short points.','a Member saves their note');
select throws_ok($$select public.save_member_note('10000000-0000-0000-0000-000000000001','my password: hunter22')$$,'22023','memberNoteSecret','a secret-looking note is refused');
select throws_ok($$select public.save_member_note('10000000-0000-0000-0000-000000000001',repeat('a',4001))$$,'22001','memberNoteTooLong','a note over 4,000 characters is refused');
select throws_ok($$update public.member_notes set note='token = abcdefgh1234' where person_id='20000000-0000-0000-0000-000000000001'$$,'23514',null,'the table itself refuses a secret-looking note');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.member_notes),0,'another Member reads no one else''s note');
select throws_ok($$insert into public.member_notes(company_id,person_id,note) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Forged')$$,'42501',null,'another Member cannot write a note as someone else');
select is(public.save_member_note('10000000-0000-0000-0000-000000000001','Write in Egyptian Arabic.'),'Write in Egyptian Arabic.','a second Member keeps their own note');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(note,'|') from public.member_notes),'Answer in short points.','each Member reads only their own note');

-- (c) A run starts at once when the Agent is free, with the sender's own note for the engine.
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000211','e3000000-0000-0000-0000-000000000201','First'),
 jsonb_build_object('state','reserved','connection','e0000000-0000-0000-0000-000000000211','note','Answer in short points.'),'the first message reserves its run, with the sender''s note');
select is(public.send_conversation_message('e2000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000211','First','e3000000-0000-0000-0000-000000000201','team_run_1','e0000000-0000-0000-0000-000000000211'),true,'and is recorded with its run');
-- While that run is open, more messages wait as the sender's own turns, in order; a retry stores nothing twice.
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000211','e3000000-0000-0000-0000-000000000202','Second'),'{"state":"queued"}'::jsonb,'a message sent while the Agent is busy waits');
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000211','e3000000-0000-0000-0000-000000000202','Second'),'{"state":"queued"}'::jsonb,'its retry waits too');
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000211','e3000000-0000-0000-0000-000000000203','Third'),'{"state":"queued"}'::jsonb,'a third message waits behind it');
select is((select string_agg(message,',' order by queued_at) from public.conversation_queued_turns),'Second,Third','two waiting turns, in the order they were sent');
select is((select count(*)::int from public.conversation_messages where conversation_id='e2000000-0000-0000-0000-000000000201'),1,'nothing waiting is merged into the record');

-- (d) A message to a person is kept as a note and starts no run, even while the Agent is busy; "@Mona" is the Agent.
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000211','e3000000-0000-0000-0000-000000000204','@مدير can you check the budget?'),'{"state":"note"}'::jsonb,'a message to a Member is a note');
select is((select addressed_to::text||' '||person_id::text from public.conversation_notes),'20000000-0000-0000-0000-000000000002 20000000-0000-0000-0000-000000000001','addressed to that Member, written by the sender');
select is((select count(*)::int from public.conversation_queued_turns),2,'and it did not join the queue');
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000209','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000211','e3000000-0000-0000-0000-000000000209','@Lead plan the week')->>'state','reserved','a Member that is an Agent is never a person: "@Lead" reaches the Agent');

-- Stop: the run's own person or a Manager or Owner; another Contributor or a Viewer is refused.
select is((select run from public.conversation_stop_target('e2000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000001')),'team_run_1','the run''s person may stop it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select * from public.conversation_stop_target('e2000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000001')$$,'42501','conversationStopNotAllowed','another Contributor cannot stop it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select * from public.conversation_stop_target('e2000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000001')$$,'42501','conversationStopNotAllowed','a Viewer cannot stop it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select run from public.conversation_stop_target('e2000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000001')),'team_run_1','a Manager may stop it');
select is((select count(*)::int from public.conversation_queued_turns),0,'a Manager still reads nothing of the person''s conversation');
select is((select count(*)::int from public.conversation_notes),0,'nor its notes');

-- The next turn starts only after the open run ends, as its own sender's message.
reset role;
set local role service_role;
select is((select count(*)::int from public.claim_conversation_turn('e2000000-0000-0000-0000-000000000201')),0,'no turn starts while the run is open');
select is(public.close_conversation_run('e2000000-0000-0000-0000-000000000201','team_run_1','completed','Done','session_1',10,2),true,'the run ends');
select is((select message||' '||person::text from public.claim_conversation_turn('e2000000-0000-0000-0000-000000000201')),'Second 20000000-0000-0000-0000-000000000001','then the oldest waiting turn is claimed for its sender');
select is(public.record_conversation_turn('e2000000-0000-0000-0000-000000000201','e3000000-0000-0000-0000-000000000202','team_run_2','e0000000-0000-0000-0000-000000000211'),true,'and recorded with its run');
select is((select count(*)::int from public.claim_conversation_turn('e2000000-0000-0000-0000-000000000201')),0,'the third turn waits for the second run');
reset role;
select is((select string_agg(author||':'||body||':'||coalesce(author_name,''),',' order by id) from public.conversation_messages where conversation_id='e2000000-0000-0000-0000-000000000201'),'person:First:عمر,agent:Done:Mona,person:Second:عمر','two turns in order, each its own message under its sender');
select throws_ok($$select public.record_conversation_turn('e2000000-0000-0000-0000-000000000201','e3000000-0000-0000-0000-000000000299','team_run_9','e0000000-0000-0000-0000-000000000211')$$,'P0002','conversationNotFound','a turn that was never queued cannot be recorded');

-- (a) A comment's author is the signed-in person, whatever the request named.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into public.work_comments(company_id,card_id,body,author_id) values ('10000000-0000-0000-0000-000000000001',(select min(id) from public.work_cards where company_id='10000000-0000-0000-0000-000000000001'),'Forged author','20000000-0000-0000-0000-000000000001');
select is((select author_id::text from public.work_comments where body='Forged author'),'20000000-0000-0000-0000-000000000005','a comment naming another author is stored under the signed-in person');

select * from finish();
rollback;
