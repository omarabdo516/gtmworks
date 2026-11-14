begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
-- Recording a reserved run takes the lock the move and the worker's abandon take, so neither can pass between its
-- check and its insert. Nothing else in this transaction takes that lock before the record.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('f8000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','http://localhost','writer','x','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('a8000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','f8000000-0000-0000-0000-000000000002','Mona','Writing');
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 values ('c8000000-0000-0000-0000-000000000002','c9000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','f8000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000002','Hi','writer');
create temporary view held_agent_lock as select exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted
 and ((classid::bigint<<32)|objid::bigint)=hashtextextended('hermes_agents',0)) as held;
grant select on held_agent_lock to authenticated;
select is((select held from held_agent_lock),false,'the lock is not held before the record');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select ok(public.send_conversation_message('c8000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','a8000000-0000-0000-0000-000000000002','Hi','c9000000-0000-0000-0000-000000000002','run_locked','f8000000-0000-0000-0000-000000000002'),'the reserved run is recorded');
select is((select held from held_agent_lock),true,'the record took the move''s lock and holds it to the end of its transaction');
reset role;
select * from finish();
rollback;
