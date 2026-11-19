begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- #179: an Agent's thinking level is the key agent.reasoning_effort of its own profile. Only the Owner changes it: the
-- database checks the save before the Engine is written (check_agent_owner_setting), and its one log row keeps the old and
-- new level (log_engine_setting). A Manager, a Contributor and a Viewer are refused, and an Agent of another Company is
-- never reached.
-- RS Learning: 1 Owner, 2 Manager, 3 Contributor, 4 Viewer; Aleem (…0003) is another Company.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1100000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','e1100000-0000-0000-0000-0000000000c1','Probe','Writing',false,'ab-probe-effort'),
 ('e1100000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','e1100000-0000-0000-0000-0000000000c3','Elsewhere','Writing',false,'ab-elsewhere-effort');
-- Probe is shown to the Manager, the Contributor and the Viewer (#15); the Owner sees every Agent.
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e1100000-0000-0000-0000-0000000000b1' from generate_series(2,4) n;
create function pg_temp.effort_rows() returns bigint language sql security definer as $$
 select count(*) from public.company_log where action='agent_setting_changed';
$$;
grant execute on function pg_temp.effort_rows() to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.check_agent_owner_setting('10000000-0000-0000-0000-000000000001','e1100000-0000-0000-0000-0000000000b1')$$,'the Owner may change the thinking level of an Agent of the Company');
select lives_ok($$select public.log_engine_setting('10000000-0000-0000-0000-000000000001','e1100000-0000-0000-0000-0000000000b1','agent.reasoning_effort','"medium"'::jsonb,'"high"'::jsonb)$$,'the Owner logs the level it chose, with the old and the new');
select is((select jsonb_build_array(actor_id,actor_kind,subject,agent_id,action,details) from public.company_log where action='agent_setting_changed' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000001','person','agent','e1100000-0000-0000-0000-0000000000b1','agent_setting_changed',
  jsonb_build_object('agent_name','Probe','setting','agent.reasoning_effort','old','medium','new','high')),'one row names the Agent, the setting and both levels');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.check_agent_owner_setting('10000000-0000-0000-0000-000000000001','e1100000-0000-0000-0000-0000000000b1')$$,'42501','agentSettingNotAllowed','a Manager may not change the level');
select throws_ok($$select public.log_engine_setting('10000000-0000-0000-0000-000000000001','e1100000-0000-0000-0000-0000000000b1','agent.reasoning_effort','"high"'::jsonb,'"max"'::jsonb)$$,'42501','settingNotAllowed','nor log it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.check_agent_owner_setting('10000000-0000-0000-0000-000000000001','e1100000-0000-0000-0000-0000000000b1')$$,'42501','agentSettingNotAllowed','a Contributor may not');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.log_engine_setting('10000000-0000-0000-0000-000000000001','e1100000-0000-0000-0000-0000000000b1','agent.reasoning_effort','"high"'::jsonb,'"max"'::jsonb)$$,'42501','settingNotAllowed','nor a Viewer');
select is(pg_temp.effort_rows(),1::bigint,'refused changes write no row');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.check_agent_owner_setting('10000000-0000-0000-0000-000000000001','e1100000-0000-0000-0000-0000000000b3')$$,'42501','agentSettingNotAllowed','an Agent of another Company is refused');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.log_engine_setting('10000000-0000-0000-0000-000000000003','e1100000-0000-0000-0000-0000000000b3','agent.reasoning_effort','"medium"'::jsonb,'"high"'::jsonb)$$,'42501','settingNotAllowed','and a Manager of one Company writes nothing in another');
reset role;
select ok(not has_function_privilege('anon','public.check_agent_owner_setting(uuid,uuid)','execute'),'no signed-out caller reaches the check');
select ok(not has_function_privilege('anon','public.log_engine_setting(uuid,uuid,text,jsonb,jsonb)','execute'),'nor the log');
select ok(has_function_privilege('authenticated','public.check_agent_owner_setting(uuid,uuid)','execute'),'a signed-in Member reaches the check, which decides the Owner alone');
select ok(has_function_privilege('authenticated','public.log_engine_setting(uuid,uuid,text,jsonb,jsonb)','execute'),'and the log');
select * from finish();
rollback;
