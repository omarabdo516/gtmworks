begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
-- A pasted Connection and its Agent in RS Learning (1); Omar (its Owner) reserves a run on it.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('c6000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001','Faye','Marketing','release-test');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_run('c6000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000002','c6000000-0000-0000-0000-000000000004','Hi'),
 'c6000000-0000-0000-0000-000000000001'::uuid,'the run is reserved on the Agent''s Connection');

-- 1. While it is active, the reservation is kept.
reset role;

-- 2. Nobody but the sender releases it, and only in its own company.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.release_conversation_run('c6000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000004'),false,'another member of the company cannot release it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.release_conversation_run('c6000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','c6000000-0000-0000-0000-000000000004'),false,'the sender cannot release it under another company');
reset role;
select ok((select abandoned_at is null from public.conversation_run_reservations where conversation_id='c6000000-0000-0000-0000-000000000003'),'it is still active after both refusals');

-- 3. The sender releases a start the engine refused at once; the row is kept, abandoned, and holds nothing.
set local role authenticated;
select is(public.release_conversation_run('c6000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000004'),true,'the sender abandons the reservation of a run that never started');
select is(public.release_conversation_run('c6000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000004'),false,'an abandoned reservation is not released twice');
reset role;
select ok((select abandoned_at is not null and connection_id='c6000000-0000-0000-0000-000000000001' from public.conversation_run_reservations where conversation_id='c6000000-0000-0000-0000-000000000003'),
 'the abandoned reservation is kept with its pinned Connection');

-- 4. A late record for it is refused; a retry with the same send key reserves again through the checks.
set local role authenticated;
select throws_ok($$select public.send_conversation_message('c6000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000002','Hi','c6000000-0000-0000-0000-000000000004','run_late','c6000000-0000-0000-0000-000000000001')$$,
 '55000','conversationSendAgain','a record after the release asks the person to send again');
select is(public.reserve_conversation_run('c6000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000002','c6000000-0000-0000-0000-000000000004','Hi'),
 'c6000000-0000-0000-0000-000000000001'::uuid,'a retry reserves again');
select public.release_conversation_run('c6000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000004');

-- 5. Released, the Connection can be removed at once, without waiting for the worker's ten minutes.
reset role;
delete from public.hermes_agents where id='c6000000-0000-0000-0000-000000000002';

-- 6. Only a signed-in person calls it.
select ok(not has_function_privilege('anon','public.release_conversation_run(uuid,uuid,uuid)','execute'),'anon cannot release a reservation');
select * from finish();
rollback;
