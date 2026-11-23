begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- #660. RS Learning (1) holds a key; Lead on the Company's own profile; two Agents waiting for a model from before the
-- update: one on a profile the Engine made, one on a profile it has not made yet. R&S Consultations (2) holds no key.
insert into public.agent_profiles(agent_id,company_id,tools_confirmed,tools_pending) values
 ('e6600000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true,false),
 ('e6600000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',false,true),
 ('e6600000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002',true,false);
insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values
 ('e6600000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','Lead','General',true,'co-10000000000000000000000000000001'),
 ('e6600000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','المحتوى','Content',false,'ag-e6600000000000000000000000000001'),
 ('e6600000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','الإعلانات','Ads',false,'ag-e6600000000000000000000000000002'),
 ('e6600000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000002','Lead two','General',true,'co-10000000000000000000000000000002'),
 ('e6600000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Writer two','Writing',false,'ag-e6600000000000000000000000000003');
insert into public.company_shared_spaces(company_id,folder) values
 ('10000000-0000-0000-0000-000000000001','/opt/data/profiles/cs-10000000000000000000000000000001/skills'),
 ('10000000-0000-0000-0000-000000000002','/opt/data/profiles/cs-10000000000000000000000000000002/skills');
insert into public.company_key_holds(company_id,provider,held,version) values
 ('10000000-0000-0000-0000-000000000001','opencode-go',true,3),('10000000-0000-0000-0000-000000000001','anthropic',false,2);
insert into public.agent_key_waits(agent_id,company_id) values
 ('e6600000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('e6600000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001'),
 ('e6600000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002');

set local role authenticated;
select throws_ok($$select * from public.agent_key_wait_work()$$,'42501',null,'a signed-in person cannot list the waits');
select throws_ok($$select public.release_agent_key_wait('e6600000-0000-0000-0000-000000000001','ag-e6600000000000000000000000000001',3)$$,'42501',null,'nor end one');
reset role;
set local role service_role;
select results_eq($$select company_id,agent_id,profile,space,keeper,seen from public.agent_key_wait_work()$$,
 $$values ('10000000-0000-0000-0000-000000000001'::uuid,'e6600000-0000-0000-0000-000000000001'::uuid,'ag-e6600000000000000000000000000001',
  'cs-10000000000000000000000000000001','co-10000000000000000000000000000001',3::bigint)$$,
 'the worker lists only a wait on a made profile, in a Company holding a key, with its space, Lead''s profile and the change count');
select is(public.release_agent_key_wait('e6600000-0000-0000-0000-000000000001','ag-e6600000000000000000000000000002',3),false,'a profile that is not the Agent''s ends nothing');
select is(public.release_agent_key_wait('e6600000-0000-0000-0000-000000000001','ag-e6600000000000000000000000000001',null),false,'nor does a release with no count');
reset role;
update public.company_key_holds set version=4 where company_id='10000000-0000-0000-0000-000000000001' and provider='anthropic';
set local role service_role;
select is(public.release_agent_key_wait('e6600000-0000-0000-0000-000000000001','ag-e6600000000000000000000000000001',3),false,'a key change since the count read leaves the wait');
reset role;
select is((select count(*)::int from public.agent_key_waits where agent_id='e6600000-0000-0000-0000-000000000001'),1,'so it is still waiting');
update public.company_key_holds set changing=true where company_id='10000000-0000-0000-0000-000000000001' and provider='opencode-go';
set local role service_role;
select is(public.release_agent_key_wait('e6600000-0000-0000-0000-000000000001','ag-e6600000000000000000000000000001',4),false,'a key change still under way, begun before the count was read, leaves the wait');
reset role;
update public.company_key_holds set changing=false where company_id='10000000-0000-0000-0000-000000000001' and provider='opencode-go';
set local role service_role;
select is(public.release_agent_key_wait('e6600000-0000-0000-0000-000000000001','ag-e6600000000000000000000000000001',4),true,'once the Engine says its profile answers, its wait ends');
reset role;
select is((select count(*)::int from public.agent_key_waits where agent_id='e6600000-0000-0000-0000-000000000001'),0,'it leaves the waits');
select is((select count(*)::int from public.agent_key_waits where agent_id='e6600000-0000-0000-0000-000000000002'),1,'and the other Agent still waits');
set local role service_role;
select is(public.release_agent_key_wait('e6600000-0000-0000-0000-000000000001','ag-e6600000000000000000000000000001',4),false,'a second release ends nothing');
select is((select count(*)::int from public.agent_key_wait_work()),0,'the profile the Engine has not made is not listed');
reset role;
update public.agent_profiles set tools_confirmed=true,tools_pending=false where agent_id='e6600000-0000-0000-0000-000000000002';
set local role service_role;
select is((select array_agg(profile) from public.agent_key_wait_work()),array['ag-e6600000000000000000000000000002'],'once made, it is listed');
reset role;

select * from finish();
rollback;
