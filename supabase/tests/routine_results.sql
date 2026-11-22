begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
-- #535: the worker keeps each Routine result once as it ends, for Agents of the Company only, and the morning draws its
-- night from what was kept: the results with a line that ended after the previous morning and by this one, newest
-- first. No Member reads the kept runs. Two Companies of its own keep every read apart from rows other tests left. Every time is read from now(), so the 30-day window never moves past them. 
set local session_replication_role=replica;
insert into public.companies(id,slug,name,engine_id) values
 ('10000000-0000-0000-0000-000000000535','routine-results','Routine results','e5350000-0000-4000-8000-000000000535'),
 ('10000000-0000-0000-0000-000000000536','routine-results-other','Other','e5350000-0000-4000-8000-000000000536');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e5350000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000535','e5350000-0000-0000-0000-000000000101','Ads','Meta ads',false,'ag-e5350000000000000000000000000001'),
 ('e5350000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000536','e5350000-0000-0000-0000-000000000102','Other','Elsewhere',false,'ag-e5350000000000000000000000000002');
set local session_replication_role=origin;

set local role service_role;
select is(public.keep_routine_results('10000000-0000-0000-0000-000000000535',jsonb_build_array(
  jsonb_build_object('agent','e5350000-0000-0000-0000-000000000001','profile','ag-e5350000000000000000000000000001','routine_id','abc123','session','local-1','routine','Every 15 minutes','line','Checked the leads 1','at',now()-interval '6 hours'),
  jsonb_build_object('agent','e5350000-0000-0000-0000-000000000001','profile','ag-e5350000000000000000000000000001','routine_id','abc123','session','local-2','routine','Every 15 minutes','line','Checked the leads 2','at',now()-interval '345 minutes'),
  jsonb_build_object('agent','e5350000-0000-0000-0000-000000000001','profile','ag-e5350000000000000000000000000001','routine_id','abc123','session','local-3','routine','Every 15 minutes','line',null,'at',now()-interval '330 minutes'),
  jsonb_build_object('agent','e5350000-0000-0000-0000-000000000001','profile','ag-e5350000000000000000000000000001','routine_id','abc123','session','local-0','routine','Every 15 minutes','line','Before the night','at',now()-interval '2 days'),
  jsonb_build_object('agent','e5350000-0000-0000-0000-000000000002','profile','ag-e5350000000000000000000000000002','routine_id','abc123','session','local-9','routine','Elsewhere','line','Not this Company''s','at',now()-interval '6 hours'))),
 4,'each run of an Agent of the Company is kept, also one that sent nothing');
select is(public.keep_routine_results('10000000-0000-0000-0000-000000000535',jsonb_build_array(
  jsonb_build_object('agent','e5350000-0000-0000-0000-000000000001','profile','ag-e5350000000000000000000000000001','routine_id','abc123','session','local-2','routine','Every 15 minutes','line','Changed','at',now()-interval '345 minutes'))),
 0,'a run is kept once');
reset role;
select is((select line from public.routine_results where company_id='10000000-0000-0000-0000-000000000535' and session_id='local-2'),'Checked the leads 2','and the first keep stands');
select is((select count(*)::int from public.routine_results where agent_id='e5350000-0000-0000-0000-000000000002'),0,'another Company''s Agent is never kept under this one');
set local role service_role;
select is(public.keep_routine_results('10000000-0000-0000-0000-000000000535',jsonb_build_array(
  jsonb_build_object('agent','e5350000-0000-0000-0000-000000000001','profile','ag-e5350000000000000000000000000002','routine_id','abc123','session','local-5','routine','Every 15 minutes','line','On another profile','at',now()-interval '5 hours'))),
 0,'a run is kept only on its Agent''s own profile');
reset role;
set local role service_role;
select is((select array_agg(s order by s) from public.routine_results_seen('10000000-0000-0000-0000-000000000535','ag-e5350000000000000000000000000001',array['local-1','local-3','local-7']) s),
 array['local-1','local-3'],'the worker reads which runs are kept already, a silent one too');
select is((select array_agg(n.line order by n.at desc) from public.good_morning_night('10000000-0000-0000-0000-000000000535',now()-interval '1 day',now()) n),
 array['Checked the leads 2','Checked the leads 1'],
 'the night is what ended since the previous morning, with a line, newest first');
select is((select count(*)::int from public.good_morning_night('10000000-0000-0000-0000-000000000536',now()-interval '1 day',now())),0,'another Company''s night holds none of it');
-- What ended over 30 days ago goes on the next keep.
reset role;
update public.routine_results set ended_at=now()-interval '31 days' where company_id='10000000-0000-0000-0000-000000000535' and session_id='local-0';
set local role service_role;
select is(public.keep_routine_results('10000000-0000-0000-0000-000000000535','[]'::jsonb),0,'an empty keep keeps nothing');
reset role;
select is((select count(*)::int from public.routine_results where company_id='10000000-0000-0000-0000-000000000535' and session_id='local-0'),0,'and lets go of what ended over 30 days ago');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select count(*) from public.routine_results$$,'42501',null,'the Owner reads no kept run directly: the card reads its morning''s own results');
reset role;
select * from finish();
rollback;
