-- #713: a Member who sees an Agent and is not a Viewer may take control of its Screen, and the check names them; taking
-- control and giving it back are one Company log row each with the person and the Agent. A Viewer, a Member the Agent is
-- hidden from and another Company's Agent are refused; a Viewer who sees the Agent still logs a give-back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000713','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000713','Ads','Ads',false,'ag-ads');
-- The Contributor and the Viewer are shown the Agent; the Manager is not.
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000713'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','e1000000-0000-0000-0000-000000000713');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.check_screen_control('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000713'),
 (select name from public.people where id='20000000-0000-0000-0000-000000000003'),'a Contributor who sees the Agent may take control, and the check names them');
select lives_ok($$select public.log_screen_taken('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000713')$$,'the take is logged');
select lives_ok($$select public.log_screen_given_back('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000713')$$,'and so is the give-back');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.check_screen_control('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000713')$$,'42501','screenNotAllowed','a Viewer may not take control');
select throws_ok($$select public.log_screen_taken('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000713')$$,'42501','screenNotAllowed','nor log a take');
select lives_ok($$select public.log_screen_given_back('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000713')$$,'a Member whose Role became Viewer while holding still logs the give-back');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.check_screen_control('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000713')$$,'42501','screenNotAllowed','a Manager the Agent is hidden from may not take control');
select throws_ok($$select public.log_screen_given_back('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000713')$$,'42501','screenNotAllowed','nor log a give-back of it');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.check_screen_control('10000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000713')$$,'42501','screenNotAllowed','an Agent of another Company is not taken from there');
select throws_ok($$select public.log_screen_given_back('10000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000713')$$,'42501','screenNotAllowed','nor given back from there');

reset role;
select is((select count(*)::int from public.company_log where agent_id='e1000000-0000-0000-0000-000000000713' and action='agent_screen_taken'),1,'one take is one row');
select results_eq($$select actor_id,details->>'agent_name' from public.company_log where agent_id='e1000000-0000-0000-0000-000000000713' and action='agent_screen_taken'$$,
 $$select '20000000-0000-0000-0000-000000000003'::uuid,'Ads'$$,'the take row names the person and the Agent');
select results_eq($$select actor_id,details->>'agent_name' from public.company_log where agent_id='e1000000-0000-0000-0000-000000000713' and action='agent_screen_given_back' order by created_at,source_id$$,
 $$select '20000000-0000-0000-0000-000000000003'::uuid,'Ads' union all select '20000000-0000-0000-0000-000000000004'::uuid,'Ads'$$,'each give-back is one row naming the person and the Agent');
select * from finish();
rollback;
