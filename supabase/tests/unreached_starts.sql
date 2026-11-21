begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
-- #413: a channel or note Run's start that never reached an Engine is handed back (release_channel_start,
-- release_note_start): the Run stays due as never started, its next start is a first attempt, so a refusal of it fails
-- the Run, and the never-started time limit still ends it. Only the attempt that began is handed back.
set local session_replication_role=replica;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values
 ('a4130000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f4130000-0000-0000-0000-000000000001','Unreached','General','unreached-test');
insert into public.channel_messages(id,company_id,channel_id,author,person_id,author_name,body,send_key) overriding system value values
 (-4131,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','@Unreached one',gen_random_uuid()),
 (-4132,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','@Unreached two',gen_random_uuid()),
 (-4133,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','@Unreached three',gen_random_uuid());
insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input,created_at) values
 (-4131,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','a4130000-0000-0000-0000-000000000001','Unreached',gen_random_uuid(),'Omar: one',now()-interval '2 minutes'),
 (-4132,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','a4130000-0000-0000-0000-000000000001','Unreached',gen_random_uuid(),'Omar: two',now()-interval '2 minutes'),
 (-4133,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','a4130000-0000-0000-0000-000000000001','Unreached',gen_random_uuid(),'Omar: three',now()-interval '11 minutes');
insert into public.work_comments(id,company_id,card_id,body,author_id) overriding system value
 select -4134,company_id,id,'@Unreached four','20000000-0000-0000-0000-000000000001' from public.work_cards
 where company_id='10000000-0000-0000-0000-000000000001' order by id limit 1;
insert into public.note_runs(note_id,company_id,card_id,agent_id,agent_name,session,input,created_at)
 select -4134,company_id,card_id,'a4130000-0000-0000-0000-000000000001','Unreached',gen_random_uuid(),'Omar: four',now()-interval '2 minutes'
 from public.work_comments where id=-4134;
set local session_replication_role=origin;

set local role authenticated;
select throws_ok($$select public.release_channel_start(-4131,1,1::smallint)$$,'42501',null,'no person may hand back a channel Run''s attempt');
select throws_ok($$select public.release_note_start(-4134,1)$$,'42501',null,'nor a note Run''s');
reset role;

set local role service_role;
-- A channel Run whose Engine was not reached.
select is((select attempt from public.begin_channel_start(-4131)),1,'a channel Run''s first start is its first attempt');
select ok(public.release_channel_start(-4131,1,1::smallint),'a start that never reached an Engine is handed back');
reset role;
select is((select attempts from public.channel_runs where message_id=-4131),0,'so the Run counts no attempt');
select ok((select first_attempted_at is null and outcome is null from public.channel_runs where message_id=-4131),'and is not given the may-have-started day either, and stays open');
set local role service_role;
select is((select count(*)::int from public.channel_runs_due(null,null,-10000) where message=-4131),1,'it stays due');
select is((select attempt from public.begin_channel_start(-4131)),1,'and its next start is a first attempt again');
select ok(public.answer_channel_start(-4131,1,null,1::smallint),'so the Engine''s refusal of it is answered');
reset role;
select is((select outcome from public.channel_runs where message_id=-4131),'failed','and fails the Run instead of retrying for a day');

-- Only the attempt that began is handed back: a later attempt, or a run id, may have reached the Engine.
set local role service_role;
select is((select attempt from public.begin_channel_start(-4132)),1,'another channel Run''s first attempt');
select is((select attempt from public.begin_channel_start(-4132)),2,'and a second driver''s attempt of it');
select is(public.release_channel_start(-4132,1,1::smallint),false,'the first attempt is not handed back once a later one began');
select is(public.release_channel_start(-4132,2,2::smallint),false,'nor is another place''s attempt');
select ok(public.answer_channel_start(-4132,2,'run-unreached-2',1::smallint),'the later attempt records its run id');
select is(public.release_channel_start(-4132,2,1::smallint),false,'and an attempt that named a run is never handed back');
reset role;
select is((select attempts||':'||run_id from public.channel_runs where message_id=-4132),'2:run-unreached-2','the Run keeps both attempts and its run');

-- An Engine that stays down still meets the never-started time limit.
update public.channel_runs set attempts=1, attempted_at=now(), first_attempted_at=now(), profile='unreached-test' where message_id=-4133;
set local role service_role;
select ok(public.release_channel_start(-4133,1,1::smallint),'an old Run''s unreached attempt is handed back');
select is((select count(*)::int from public.begin_channel_start(-4133)),0,'and once it is ten minutes old it starts no more');
reset role;
select is((select outcome from public.channel_runs where message_id=-4133),'failed','it fails as never started');

-- A note Run, on the same terms.
set local role service_role;
select is((select attempt from public.begin_note_start(-4134)),1,'a note Run''s first start is its first attempt');
select ok(public.release_note_start(-4134,1),'a start that never reached an Engine is handed back');
select is((select attempt from public.begin_note_start(-4134)),1,'and its next start is a first attempt again');
select is(public.release_note_start(-4134,2),false,'an attempt that did not begin is not handed back');
reset role;

select * from finish();
rollback;
