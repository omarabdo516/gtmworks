begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
-- #699: the worker keeps, on each pass, which Routines of an Agent's profile its Engine is running now, so the state read
-- can tell the Agent is working. Each keep is the profile's whole set: a Routine left out has ended. Only the worker
-- keeps it; no Member reads it. Two Companies of its own keep every read apart from rows other tests left.
set local session_replication_role=replica;
insert into public.companies(id,slug,name,engine_id) values
 ('10000000-0000-0000-0000-000000000699','routine-runs-open','Routine runs open','e6990000-0000-4000-8000-000000000699'),
 ('10000000-0000-0000-0000-000000000698','routine-runs-other','Other','e6990000-0000-4000-8000-000000000698');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e6990000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000699','e6990000-0000-0000-0000-000000000101','Ads','Meta ads',false,'ag-e6990000000000000000000000000001'),
 ('e6990000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000698','e6990000-0000-0000-0000-000000000102','Other','Elsewhere',false,'ag-e6990000000000000000000000000002');
set local session_replication_role=origin;

set local role service_role;
select is(public.keep_running_routines('10000000-0000-0000-0000-000000000699','ag-e6990000000000000000000000000001','e6990000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('routine_id','abc123','started_at',now()-interval '1 minute'),jsonb_build_object('routine_id','def456','started_at',now()))),
 2,'the Routines the Engine runs now on the Agent''s profile are kept');
select is(public.keep_running_routines('10000000-0000-0000-0000-000000000699','ag-e6990000000000000000000000000001','e6990000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('routine_id','abc123','started_at',now()-interval '1 minute'))),
 1,'the next pass keeps only what still runs');
reset role;
select results_eq($$select routine_id,started_at=now()-interval '1 minute' from public.routine_runs_open where company_id='10000000-0000-0000-0000-000000000699'$$,
 $$values ('abc123'::text,true)$$,'a Routine that ended is gone, and one still running keeps its start');
set local role service_role;
select is(public.keep_running_routines('10000000-0000-0000-0000-000000000699','ag-e6990000000000000000000000000001','e6990000-0000-0000-0000-000000000001','[]'::jsonb),
 0,'a pass with nothing running empties the profile''s set');
select is(public.keep_running_routines('10000000-0000-0000-0000-000000000699','ag-e6990000000000000000000000000002','e6990000-0000-0000-0000-000000000002',
  jsonb_build_array(jsonb_build_object('routine_id','abc123','started_at',now()))),
 0,'another Company''s Agent is never kept under this one');
select is(public.keep_running_routines('10000000-0000-0000-0000-000000000699','ag-e6990000000000000000000000000002','e6990000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('routine_id','abc123','started_at',now()))),
 0,'nor an Agent on a profile that is not its own');
select throws_ok($$select public.keep_running_routines('10000000-0000-0000-0000-000000000699','ag-e6990000000000000000000000000001','e6990000-0000-0000-0000-000000000001','{}'::jsonb)$$,
 '22023',null,'a set that is not a list is refused');
reset role;
select is((select count(*)::int from public.routine_runs_open where company_id in ('10000000-0000-0000-0000-000000000699','10000000-0000-0000-0000-000000000698')),0,'nothing was kept wrongly');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.keep_running_routines('10000000-0000-0000-0000-000000000699','ag-e6990000000000000000000000000001','e6990000-0000-0000-0000-000000000001','[]'::jsonb)$$,
 '42501',null,'a Member cannot keep it');
select * from finish();
rollback;
