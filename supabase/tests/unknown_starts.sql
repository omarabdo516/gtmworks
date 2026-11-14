begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
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

select * from finish();
rollback;
