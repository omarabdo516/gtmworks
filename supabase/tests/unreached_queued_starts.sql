begin;
create extension if not exists pgtap with schema extensions;
select plan(45);
-- #514: a queued Conversation turn's start, or a handover leg's, that never reached an Engine is handed back
-- (release_queued_start, release_handover_start): the turn or leg stays due as never started, its next start is a first
-- attempt, so a refusal of it fails the turn or the leg, and its own time limit still ends it. Only the attempt that
-- began is handed back. RS Learning: Omar (1) is Owner.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('e5140000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','e5140000-0000-0000-0000-0000000000f1','Nour','Writing',false,'unreached-queued');

-- Each Conversation gets a waiting turn: a first message reserves its run and is released unsent, so the second, which
-- waited behind it, is the turn the worker claims.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.reserve_conversation_turn(('e5140000-0000-0000-0000-00000000020'||n)::uuid,'10000000-0000-0000-0000-000000000001','e5140000-0000-0000-0000-000000000001',('e5140000-0000-0000-0000-00000000030'||n)::uuid,'First') from generate_series(1,2) n;
select is((select count(*)::int from generate_series(1,2) n where public.reserve_conversation_turn(('e5140000-0000-0000-0000-00000000020'||n)::uuid,'10000000-0000-0000-0000-000000000001','e5140000-0000-0000-0000-000000000001',('e5140000-0000-0000-0000-00000000040'||n)::uuid,'Second')->>'state'='queued'),2,'a second message waits in each Conversation');
select is((select count(*)::int from generate_series(1,2) n where public.release_conversation_run(('e5140000-0000-0000-0000-00000000020'||n)::uuid,'10000000-0000-0000-0000-000000000001',('e5140000-0000-0000-0000-00000000030'||n)::uuid,0)),2,'and the first is released unsent');
select throws_ok($$select public.release_queued_start('e5140000-0000-0000-0000-000000000201','e5140000-0000-0000-0000-000000000401',1)$$,'42501',null,'no person may hand back a queued turn''s attempt');
select throws_ok($$select public.release_handover_start(1,1,'waiting')$$,'42501',null,'nor a handover leg''s');
reset role;

-- A queued turn whose Engine was not reached.
set local role service_role;
select is((select send_key::text||' '||retry::text from public.claim_conversation_turn('e5140000-0000-0000-0000-000000000201')),'e5140000-0000-0000-0000-000000000401 false','the worker claims the waiting turn as a first start');
select is(public.begin_start('e5140000-0000-0000-0000-000000000201','e5140000-0000-0000-0000-000000000401'),1,'its first attempt');
select is(public.release_queued_start('e5140000-0000-0000-0000-000000000201','e5140000-0000-0000-0000-000000000401',2),false,'an attempt that did not begin is not handed back');
select ok(public.release_queued_start('e5140000-0000-0000-0000-000000000201','e5140000-0000-0000-0000-000000000401',1),'a start that never reached an Engine is handed back');
reset role;
select ok((select start_attempts=0 and start_unreached_at is not null and abandoned_at is null and start_unknown_at is null from public.conversation_run_reservations where send_key='e5140000-0000-0000-0000-000000000401'),'so its reservation counts no attempt, is kept, and notes it was handed back');
select ok((select failed_at is null and started_at is null from public.conversation_queued_turns where send_key='e5140000-0000-0000-0000-000000000401'),'and the turn stays waiting');
set local role service_role;
select is((select send_key::text||' '||retry::text from public.claim_conversation_turn('e5140000-0000-0000-0000-000000000201')),'e5140000-0000-0000-0000-000000000401 false','the next pass claims it as a first start again');
select is(public.begin_start('e5140000-0000-0000-0000-000000000201','e5140000-0000-0000-0000-000000000401'),1,'its next attempt is a first one');
select public.fail_conversation_turn('e5140000-0000-0000-0000-000000000201','e5140000-0000-0000-0000-000000000401',1);
reset role;
select ok((select failed_at is not null from public.conversation_queued_turns where send_key='e5140000-0000-0000-0000-000000000401'),'so the Engine''s refusal of it fails the turn instead of retrying for a day');

-- An Engine that stays down still meets the reservation's ten minutes: the turn fails, and is never reserved again.
set local role service_role;
select is((select send_key::text from public.claim_conversation_turn('e5140000-0000-0000-0000-000000000202')),'e5140000-0000-0000-0000-000000000402','another Conversation''s waiting turn is claimed');
select is(public.begin_start('e5140000-0000-0000-0000-000000000202','e5140000-0000-0000-0000-000000000402'),1,'its first attempt');
select ok(public.release_queued_start('e5140000-0000-0000-0000-000000000202','e5140000-0000-0000-0000-000000000402',1),'is handed back');
reset role;
update public.conversation_run_reservations set created_at=now()-interval '11 minutes' where send_key='e5140000-0000-0000-0000-000000000402';
set local role service_role;
select public.abandon_conversation_reservations();
reset role;
select ok((select abandoned_at is not null from public.conversation_run_reservations where send_key='e5140000-0000-0000-0000-000000000402'),'ten minutes on, its reservation is given up');
select ok((select failed_at is not null from public.conversation_queued_turns where send_key='e5140000-0000-0000-0000-000000000402'),'and its turn fails, so its sender sees it was not sent');
set local role service_role;
select is((select count(*)::int from public.claim_conversation_turn('e5140000-0000-0000-0000-000000000202')),0,'and nothing is claimed again');

-- An attempt in flight on a reservation handed back within the last minute is that pass's own, not a lost start: it is
-- not marked unknown, so the ten minutes stay. One counted a minute after the last hand back is marked as before.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_turn('e5140000-0000-0000-0000-000000000204','10000000-0000-0000-0000-000000000001','e5140000-0000-0000-0000-000000000001','e5140000-0000-0000-0000-000000000304','Fourth')->>'state','reserved','another run is reserved');
reset role;
update public.conversation_run_reservations set created_at=now()-interval '11 minutes', start_attempts=1, start_unreached_at=now()-interval '5 seconds' where send_key='e5140000-0000-0000-0000-000000000304';
set local role service_role;
select public.abandon_conversation_reservations();
reset role;
select ok((select start_unknown_at is null and abandoned_at is null from public.conversation_run_reservations where send_key='e5140000-0000-0000-0000-000000000304'),'an attempt in flight just after a hand back is not marked unknown');
update public.conversation_run_reservations set start_unreached_at=now()-interval '2 minutes' where send_key='e5140000-0000-0000-0000-000000000304';
set local role service_role;
select public.abandon_conversation_reservations();
reset role;
select ok((select start_unknown_at is not null and abandoned_at is null from public.conversation_run_reservations where send_key='e5140000-0000-0000-0000-000000000304'),'one still counted a minute later is kept as a lost start, as before');

-- A start marked unknown may hold a run: it is never handed back.
select is(public.begin_start('e5140000-0000-0000-0000-000000000201','e5140000-0000-0000-0000-000000000499'),0,'no attempt begins without a reservation');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_turn('e5140000-0000-0000-0000-000000000203','10000000-0000-0000-0000-000000000001','e5140000-0000-0000-0000-000000000001','e5140000-0000-0000-0000-000000000303','Third')->>'state','reserved','a message sent straight away reserves its run');
reset role;
set local role service_role;
select is(public.begin_start('e5140000-0000-0000-0000-000000000203','e5140000-0000-0000-0000-000000000303'),1,'its first attempt');
select ok(public.keep_unknown_start('e5140000-0000-0000-0000-000000000203','e5140000-0000-0000-0000-000000000303'),'is lost and kept as unknown');
select is(public.release_queued_start('e5140000-0000-0000-0000-000000000203','e5140000-0000-0000-0000-000000000303',1),false,'so it is not handed back');
reset role;

-- Handover legs. Lead on the Company's own profile hands jobs to Ads on its own.
insert into public.agent_profiles(agent_id,company_id,tools_confirmed,skills_shared) values ('a5140000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',true,true);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,instructions) values
 ('a5140000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','f5140000-0000-0000-0000-000000000011','Lead','General',true,'co-10000000000000000000000000000001','Lead the team.'),
 ('a5140000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','f5140000-0000-0000-0000-000000000012','Ads','Ads',false,'ag-a5140000000000000000000000000012','Run the Meta ads.');
insert into public.company_profiles(company_id,profile,skills_shared,tools_confirmed) values ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',true,true)
 on conflict (company_id) do update set profile=excluded.profile,skills_shared=true,tools_confirmed=true;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c5140000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a5140000-0000-0000-0000-000000000011','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c5140000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','Plan the March intake',gen_random_uuid(),'run-514');
insert into public.agent_handovers(id,company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal) overriding system value values
 (-5141,'10000000-0000-0000-0000-000000000001','c5140000-0000-0000-0000-000000000001','run-514','call-1','a5140000-0000-0000-0000-000000000011','a5140000-0000-0000-0000-000000000012','Refused once it runs'),
 (-5142,'10000000-0000-0000-0000-000000000001','c5140000-0000-0000-0000-000000000001','run-514','call-2','a5140000-0000-0000-0000-000000000011','a5140000-0000-0000-0000-000000000012','Down for ten minutes'),
 (-5143,'10000000-0000-0000-0000-000000000001','c5140000-0000-0000-0000-000000000001','run-514','call-3','a5140000-0000-0000-0000-000000000011','a5140000-0000-0000-0000-000000000012','Started');

set local role service_role;
select is((select attempt from public.begin_handover(-5141)),1,'a waiting leg''s first attempt');
select is(public.release_handover_start(-5141,1,'returning') or public.release_handover_start(-5141,2,'waiting'),false,'another leg''s attempt, or one that did not begin, is not handed back');
select ok(public.release_handover_start(-5141,1,'waiting'),'a start that never reached an Engine is handed back');
reset role;
select is((select state||':'||target_attempts from public.agent_handovers where call_id='call-1'),'waiting:0','so the leg stays waiting with no attempt');
-- The 30 seconds between starts pass.
update public.agent_handovers set attempted_at=now()-interval '1 minute' where call_id='call-1';
set local role service_role;
select is((select attempt from public.begin_handover(-5141)),1,'its next start is a first attempt again');
select ok(public.answer_handover(-5141,1,null,'waiting'),'so the Engine''s refusal of it is answered');
reset role;
select is((select state||':'||target_outcome from public.agent_handovers where call_id='call-1'),'returning:failed','and the job fails, and goes back to Lead to say so');

-- An Engine that stays down still meets the waiting leg's ten minutes.
set local role service_role;
select ok((select public.release_handover_start(-5142,attempt,'waiting') from public.begin_handover(-5142)),'another job''s first attempt is handed back');
reset role;
update public.agent_handovers set created_at=now()-interval '11 minutes', attempted_at=now()-interval '1 minute' where call_id='call-2';
set local role service_role;
select is((select count(*)::int from public.begin_handover(-5142)),0,'ten minutes on, it starts no more');
reset role;
select is((select state||':'||target_outcome||':'||coalesce(session_held_until::text,'free') from public.agent_handovers where call_id='call-2'),'returning:failed:free','it fails as never started, holding the target''s session no longer');

-- A leg that recorded its run is never handed back.
set local role service_role;
select ok((select public.answer_handover(-5143,attempt,'run-514-target','waiting') from public.begin_handover(-5143)),'a third job starts its Run');
select is(public.release_handover_start(-5143,1,'waiting'),false,'and its attempt is not handed back');
reset role;

-- #478: a leg Stop marked while its start was on its way ends as stopped once that start is handed back, instead of
-- starting again after Stop: nothing reached an Engine, so there is no Run to stop.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c5140000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a5140000-0000-0000-0000-000000000011','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c5140000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000001','Omar','Plan the April intake',gen_random_uuid(),'run-514-stop');
insert into public.agent_handovers(id,company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal) overriding system value values
 (-5144,'10000000-0000-0000-0000-000000000001','c5140000-0000-0000-0000-000000000002','run-514-stop','call-4','a5140000-0000-0000-0000-000000000011','a5140000-0000-0000-0000-000000000012','Stopped on its way');
set local role service_role;
select is((select attempt from public.begin_handover(-5144)),1,'a fourth job''s start is on its way');
reset role;
select is((select count(*)::int from public.stop_open_handovers('c5140000-0000-0000-0000-000000000002',null) where run is null),1,'when Stop marks it to end once its start answers');
set local role service_role;
select ok(public.release_handover_start(-5144,1,'waiting'),'the start never reached an Engine and is handed back');
reset role;
select is((select state||':'||target_outcome||':'||target_attempts from public.agent_handovers where id=-5144),'done:stopped:1','so the leg ends as stopped, and starts no more');

-- One whose earlier start may hold a Run stays marked when a later attempt is handed back, so its retry still recovers
-- that Run for Stop to stop.
insert into public.agent_handovers(id,company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal) overriding system value values
 (-5145,'10000000-0000-0000-0000-000000000001','c5140000-0000-0000-0000-000000000002','run-514-stop','call-5','a5140000-0000-0000-0000-000000000011','a5140000-0000-0000-0000-000000000012','Lost, then stopped');
update public.agent_handovers set target_attempts=2, attempted_at=now(), stop_requested_at=now() where id=-5145;
set local role service_role;
select ok(public.release_handover_start(-5145,2,'waiting'),'a later attempt that never reached an Engine is handed back');
reset role;
select is((select state||':'||target_attempts||':'||(stop_requested_at is not null) from public.agent_handovers where id=-5145),'waiting:1:true',
 'but the leg stays marked and due, since its first start may hold a Run');

select * from finish();
rollback;
