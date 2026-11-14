begin;
create extension if not exists pgtap with schema extensions;
select plan(33);
-- RS Learning: Omar (1) is Owner. A start whose answer was lost is kept as Omar's own waiting turn on its own
-- reservation, asked again by the worker as a retry, and never abandoned to another Connection.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('e0000000-0000-0000-0000-000000000411','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','unknown-starts','ciphertext','connected');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('e1000000-0000-0000-0000-000000000411','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000411','Nour','Writing',false);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000401','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000411','e3000000-0000-0000-0000-000000000401','First')->>'state','reserved','the first message reserves its run');
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000401','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000411','e3000000-0000-0000-0000-000000000402','Second')->>'state','queued','a second message waits behind it');
select throws_ok($$select public.keep_unknown_start('e2000000-0000-0000-0000-000000000401','e3000000-0000-0000-0000-000000000401')$$,'42501',null,'a Member cannot mark a start unknown');
reset role;

set local role service_role;
select is(public.keep_unknown_start('e2000000-0000-0000-0000-000000000401','e3000000-0000-0000-0000-000000000401'),true,'the worker or the app marks the lost start');
reset role;
select ok((select start_unknown_at is not null and abandoned_at is null from public.conversation_run_reservations where send_key='e3000000-0000-0000-0000-000000000401'),'its reservation is kept and marked');
select ok((select (select queued_at from public.conversation_queued_turns where send_key='e3000000-0000-0000-0000-000000000401')<(select queued_at from public.conversation_queued_turns where send_key='e3000000-0000-0000-0000-000000000402')),'it becomes its sender''s turn, ahead of the message that waited behind it');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000401','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000411','e3000000-0000-0000-0000-000000000401','First')->>'state','queued','the person''s own retry finds it waiting');
reset role;

set local role service_role;
select is((select send_key::text||' '||connection::text||' '||retry::text from public.claim_conversation_turn('e2000000-0000-0000-0000-000000000401')),'e3000000-0000-0000-0000-000000000401 e0000000-0000-0000-0000-000000000411 true','the worker claims it on its own Connection, as a retry');
reset role;

-- Ten minutes do not abandon it: the run may exist.
update public.conversation_run_reservations set created_at=now()-interval '11 minutes' where send_key='e3000000-0000-0000-0000-000000000401';
set local role service_role;
select public.abandon_conversation_reservations();
reset role;
select ok((select abandoned_at is null from public.conversation_run_reservations where send_key='e3000000-0000-0000-0000-000000000401'),'a lost start outlives the ten minutes');

-- After a day it is given up: abandoned, and its turn failed so it is never reserved again on another Connection.
update public.conversation_run_reservations set start_unknown_at=now()-interval '25 hours' where send_key='e3000000-0000-0000-0000-000000000401';
set local role service_role;
select public.abandon_conversation_reservations();
reset role;
select ok((select abandoned_at is not null from public.conversation_run_reservations where send_key='e3000000-0000-0000-0000-000000000401'),'after a day it is abandoned');
select ok((select failed_at is not null from public.conversation_queued_turns where send_key='e3000000-0000-0000-0000-000000000401'),'and its turn is failed, so its sender sees it was not sent');
set local role service_role;
select is((select send_key::text||' '||retry::text from public.claim_conversation_turn('e2000000-0000-0000-0000-000000000401')),'e3000000-0000-0000-0000-000000000402 false','the next turn goes, as a first start');
select is(public.keep_unknown_start('e2000000-0000-0000-0000-000000000401','e3000000-0000-0000-0000-000000000499'),false,'nothing is marked without an active reservation');
reset role;

-- An ordinary reservation still ends after ten minutes.
update public.conversation_run_reservations set created_at=now()-interval '11 minutes' where send_key='e3000000-0000-0000-0000-000000000402';
set local role service_role;
select public.abandon_conversation_reservations();
reset role;
select ok((select abandoned_at is not null from public.conversation_run_reservations where send_key='e3000000-0000-0000-0000-000000000402'),'an unmarked reservation is abandoned after ten minutes as before');

-- An attempt recorded before Hermes is called outlives a crash: after ten minutes unrecorded it becomes a marked turn,
-- asked again on its own Connection, instead of being abandoned.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000403','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000411','e3000000-0000-0000-0000-000000000403','Third')->>'state','reserved','a message in another conversation reserves its run');
reset role;
set local role service_role;
select is(public.begin_start('e2000000-0000-0000-0000-000000000403','e3000000-0000-0000-0000-000000000403'),1,'its first attempt is recorded before Hermes is called');
reset role;
update public.conversation_run_reservations set created_at=now()-interval '11 minutes' where send_key='e3000000-0000-0000-0000-000000000403';
set local role service_role;
select public.abandon_conversation_reservations();
reset role;
select ok((select abandoned_at is null and start_unknown_at is not null from public.conversation_run_reservations where send_key='e3000000-0000-0000-0000-000000000403'),'an attempted start left unrecorded is kept and marked, not abandoned');
select ok(exists(select 1 from public.conversation_queued_turns where send_key='e3000000-0000-0000-0000-000000000403' and failed_at is null and started_at is null),'and becomes its sender''s turn');

-- Neither a refusal from a second claimer nor the sender's release drops a marked start.
set local role service_role;
select public.fail_conversation_turn('e2000000-0000-0000-0000-000000000403','e3000000-0000-0000-0000-000000000403',1);
reset role;
select ok((select abandoned_at is null from public.conversation_run_reservations where send_key='e3000000-0000-0000-0000-000000000403')
 and exists(select 1 from public.conversation_queued_turns where send_key='e3000000-0000-0000-0000-000000000403' and failed_at is null),'a marked turn is not failed');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.release_conversation_run('e2000000-0000-0000-0000-000000000403','10000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000403',1),false,'nor released');

-- A turn whose message was recorded meanwhile (the direct send's late record) is not started a second time.
select is(public.send_conversation_message('e2000000-0000-0000-0000-000000000403','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000411','Third','e3000000-0000-0000-0000-000000000403','unknown_run_3','e0000000-0000-0000-0000-000000000411'),true,'the late record of the direct send lands');
reset role;
set local role service_role;
select public.close_conversation_run('e2000000-0000-0000-0000-000000000403','unknown_run_3','completed','Done','session_3',1,1);
select is((select count(*)::int from public.claim_conversation_turn('e2000000-0000-0000-0000-000000000403')),0,'its waiting turn is not claimed again');
reset role;

-- Attempts are counted. A turn already attempted (by a stopped worker or another claimer) is claimed again as a retry,
-- and a refusal naming an earlier attempt neither fails nor releases it.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000405','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000411','e3000000-0000-0000-0000-000000000405','Fifth')->>'state','reserved','a run is reserved');
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000405','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000411','e3000000-0000-0000-0000-000000000406','Sixth')->>'state','queued','a turn waits behind it');
select is(public.send_conversation_message('e2000000-0000-0000-0000-000000000405','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000411','Fifth','e3000000-0000-0000-0000-000000000405','unknown_run_5','e0000000-0000-0000-0000-000000000411'),true,'the first run is recorded');
reset role;
set local role service_role;
select public.close_conversation_run('e2000000-0000-0000-0000-000000000405','unknown_run_5','completed','Done','session_5',1,1);
select is((select retry from public.claim_conversation_turn('e2000000-0000-0000-0000-000000000405')),false,'the waiting turn is claimed as a first start');
select is(public.begin_start('e2000000-0000-0000-0000-000000000405','e3000000-0000-0000-0000-000000000406'),1,'and attempted');
select is((select retry from public.claim_conversation_turn('e2000000-0000-0000-0000-000000000405')),true,'claimed again before any answer, it is a retry');
select is(public.begin_start('e2000000-0000-0000-0000-000000000405','e3000000-0000-0000-0000-000000000406'),2,'its second attempt');
select public.fail_conversation_turn('e2000000-0000-0000-0000-000000000405','e3000000-0000-0000-0000-000000000406',1);
reset role;
select ok((select failed_at is null from public.conversation_queued_turns where send_key='e3000000-0000-0000-0000-000000000406')
 and exists(select 1 from public.conversation_run_reservations where send_key='e3000000-0000-0000-0000-000000000406' and abandoned_at is null),'the first attempt''s refusal fails nothing once a second attempt was made');

-- A turn's late record finds its message already stored by the direct send: it is started, never shown as not sent.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_turn('e2000000-0000-0000-0000-000000000407','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000411','e3000000-0000-0000-0000-000000000407','Seventh')->>'state','reserved','a direct send reserves its run');
reset role;
set local role service_role;
select public.begin_start('e2000000-0000-0000-0000-000000000407','e3000000-0000-0000-0000-000000000407');
select public.keep_unknown_start('e2000000-0000-0000-0000-000000000407','e3000000-0000-0000-0000-000000000407');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.send_conversation_message('e2000000-0000-0000-0000-000000000407','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000411','Seventh','e3000000-0000-0000-0000-000000000407','unknown_run_7','e0000000-0000-0000-0000-000000000411');
reset role;
set local role service_role;
select is(public.record_conversation_turn('e2000000-0000-0000-0000-000000000407','e3000000-0000-0000-0000-000000000407','unknown_run_7','e0000000-0000-0000-0000-000000000411'),false,'the worker''s record stores nothing twice');
reset role;
select ok((select started_at is not null and failed_at is null from public.conversation_queued_turns where send_key='e3000000-0000-0000-0000-000000000407'),'and its turn reads as started, not failed');

select * from finish();
rollback;
