begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
-- #764 (ADR 0029): a message is stored as its sender's waiting turn by one call, before any Run starts; a repeated send
-- key stores it once; the starter's claim takes it once; a turn the Engine refused is "not sent" and "Try again" puts
-- the same turn back to waiting; a refusal by the database stores nothing; the previous release's send still works.
-- RS Learning: Omar (1) is Owner, 3 a Contributor (the Agent here is hidden from them), 4 a Viewer.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a7640000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f7640000-0000-0000-0000-000000000001','Stored','General',false,'default');
create function pg_temp.send(conversation uuid, message_key uuid, message text default 'Plan the week') returns text language sql as $$
 select public.queue_conversation_turn(conversation,'10000000-0000-0000-0000-000000000001','a7640000-0000-0000-0000-000000000001',message_key,message)->>'state'
$$;
create function pg_temp.turns(conversation uuid) returns integer language sql security definer as $$
 select count(*)::integer from public.conversation_queued_turns where conversation_id=conversation
$$;
create function pg_temp.failed(conversation uuid, message_key uuid) returns boolean language sql security definer as $$
 select failed_at is not null from public.conversation_queued_turns where conversation_id=conversation and send_key=message_key
$$;
create function pg_temp.reservations(conversation uuid) returns integer language sql security definer as $$
 select count(*)::integer from public.conversation_run_reservations where conversation_id=conversation and abandoned_at is null
$$;
grant execute on all functions in schema pg_temp to authenticated,service_role;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(pg_temp.send('c7640000-0000-0000-0000-000000000001','d7640000-0000-0000-0000-000000000001'),'queued','an Owner''s message is stored as their waiting turn');
select is(pg_temp.turns('c7640000-0000-0000-0000-000000000001'),1,'one turn');
select is(pg_temp.reservations('c7640000-0000-0000-0000-000000000001'),0,'and no Run is reserved by the send: the starter does that');
select is(pg_temp.send('c7640000-0000-0000-0000-000000000001','d7640000-0000-0000-0000-000000000001'),'queued','the same send key again, from this tab or another, is the same turn');
select is(pg_temp.turns('c7640000-0000-0000-0000-000000000001'),1,'still one turn');
select is((select count(*)::int from public.conversations where id='c7640000-0000-0000-0000-000000000001'),1,'the new Conversation is made with it');
select ok((select last_message_at>now()-interval '1 minute' from public.conversations where id='c7640000-0000-0000-0000-000000000001'),'and is the newest chat by its waiting message, before its Run stores it');
select is(public.queue_conversation_turn('c7640000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','a7640000-0000-0000-0000-000000000001','d7640000-0000-0000-0000-000000000009','',true)->>'state',
 'opened','open_only makes a Conversation for its files first, with no turn');
select is(pg_temp.turns('c7640000-0000-0000-0000-000000000002'),0,'and stores no turn');

-- The starter claims the turn once: a second claim finds it reserved.
reset role;
set local role service_role;
select is((select count(*)::int from public.claim_conversation_turn('c7640000-0000-0000-0000-000000000001')),1,'the starter claims the turn');
select is(public.begin_turn_start('c7640000-0000-0000-0000-000000000001','d7640000-0000-0000-0000-000000000001'),1,'its start is begun');
select is((select count(*)::int from public.claim_conversation_turn('c7640000-0000-0000-0000-000000000001')),1,'a second starter at the same moment (the request and the worker) claims it too');
select is(public.begin_turn_start('c7640000-0000-0000-0000-000000000001','d7640000-0000-0000-0000-000000000001'),0,'but begins no second start while the first is in flight');
select lives_ok($$select public.fail_conversation_turn('c7640000-0000-0000-0000-000000000001','d7640000-0000-0000-0000-000000000001',1)$$,'the Engine refused it');
select is(pg_temp.failed('c7640000-0000-0000-0000-000000000001','d7640000-0000-0000-0000-000000000001'),true,'the message stays, not sent');

-- Try again: the same turn waits again, and no second message is made.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.retry_conversation_turn('c7640000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7640000-0000-0000-0000-000000000001'),true,'Try again puts it back to waiting');
select is(pg_temp.failed('c7640000-0000-0000-0000-000000000001','d7640000-0000-0000-0000-000000000001'),false,'it is no longer failed');
select is(pg_temp.turns('c7640000-0000-0000-0000-000000000001'),1,'and it is the same one turn');
select is(public.retry_conversation_turn('c7640000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7640000-0000-0000-0000-000000000001'),false,'a turn already waiting is not retried again');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.retry_conversation_turn('c7640000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7640000-0000-0000-0000-000000000001')$$,
 'P0002',null,'nobody but its sender tries it again');

-- A refusal the database gives stores nothing: a Viewer.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select pg_temp.send('c7640000-0000-0000-0000-000000000003','d7640000-0000-0000-0000-000000000003')$$,'42501',null,'a Viewer may not send');
reset role;
select is(pg_temp.turns('c7640000-0000-0000-0000-000000000003'),0,'and nothing was stored');

select * from finish();
rollback;
