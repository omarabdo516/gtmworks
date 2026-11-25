-- #712: a Member who sees an Agent and is not a Viewer may wake its Screen, and the wake is one Company log row with the
-- person and the Agent. A Viewer, a Member the Agent is hidden from and another Company's Agent are refused.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000712','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000712','Ads','Ads',false,'ag-ads');
-- The Contributor and the Viewer are shown the Agent; the Manager is not.
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000712'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','e1000000-0000-0000-0000-000000000712');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select lives_ok($$select public.check_screen_wake('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000712')$$,'a Contributor who sees the Agent may wake its Screen');
select lives_ok($$select public.log_screen_woken('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000712')$$,'and the wake is logged');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.check_screen_wake('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000712')$$,'42501','screenNotAllowed','a Viewer may not wake it');
select throws_ok($$select public.log_screen_woken('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000712')$$,'42501','screenNotAllowed','nor log a wake');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.check_screen_wake('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000712')$$,'42501','screenNotAllowed','a Manager the Agent is hidden from may not wake it');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.check_screen_wake('10000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000712')$$,'42501','screenNotAllowed','an Agent of another Company is not woken from there');

reset role;
select is((select count(*)::int from public.company_log where agent_id='e1000000-0000-0000-0000-000000000712' and action='agent_screen_woken'),1,'one wake is one row');
select is((select actor_id from public.company_log where agent_id='e1000000-0000-0000-0000-000000000712' and action='agent_screen_woken'),'20000000-0000-0000-0000-000000000003'::uuid,'the row names the person who woke it');
select is((select details->>'agent_name' from public.company_log where agent_id='e1000000-0000-0000-0000-000000000712' and action='agent_screen_woken'),'Ads','and the Agent whose Screen it was');
select * from finish();
rollback;
