begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
-- #161: an Agent's page saves its About on the Agent's own Engine profile; the database checks the save before the
-- Engine is written and logs one row of the Company log with who, the Agent, the field and the old and new values.
-- RS Learning: 1 Owner, 2 Manager, 3 Contributor, 4 Viewer; Aleem (…0003) is another Company.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-0000000000b1','Probe','Writing',false,'ab-probe'),
 ('e1000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-0000000000b3','Elsewhere','Writing',false,'ab-elsewhere');
-- Probe is shown to the Manager, the Contributor and the Viewer (#15); the Owner sees every Agent.
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e1000000-0000-0000-0000-0000000000b1' from generate_series(2,4) n;
create function pg_temp.setting_rows() returns bigint language sql security definer as $$
 select count(*) from public.company_log where action='agent_setting_changed';
$$;
grant execute on function pg_temp.setting_rows() to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.check_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1')$$,'the Owner may change an Agent of the Company');
select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1','about',null,null);
select is((select jsonb_build_array(actor_id,actor_kind,subject,agent_id,action,details) from public.company_log where action='agent_setting_changed' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000001','person','agent','e1000000-0000-0000-0000-0000000000b1','agent_setting_changed',
  jsonb_build_object('agent_name','Probe','field','about')),'About writes one row: who, the Agent and the field, with no text');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.check_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1')$$,'a Manager may too');
select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1','about',null,null);
select is((select actor_id from public.company_log where action='agent_setting_changed' order by id desc limit 1),'20000000-0000-0000-0000-000000000002'::uuid,'the row names the Manager');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1','instructions','before','after')$$,'22023','agentSettingInvalid','a Manager names no field but About and Voice, and keeps no text of its own');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.check_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1')$$,'42501','agentSettingNotAllowed','a Contributor may not');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1','about',null,null)$$,'42501','agentSettingNotAllowed','nor a Viewer');
select is(pg_temp.setting_rows(),2::bigint,'refused changes write no row');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.check_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b3')$$,'42501','agentSettingNotAllowed','an Agent of another Company is refused');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-0000000000b3','about',null,null)$$,'42501','agentSettingNotAllowed','and a Manager of one Company changes nothing in another');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1','About',null,null)$$,'22023','agentSettingInvalid','a field name this version has no words for is never logged');
select throws_ok($$select public.log_agent_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1','about',repeat('x',501),null)$$,'22023','agentSettingInvalid','nor any value of its own');
reset role;
select ok(not has_function_privilege('anon','public.check_agent_setting(uuid,uuid)','execute'),'no signed-out caller reaches the check');
select ok(not has_function_privilege('anon','public.log_agent_setting(uuid,uuid,text,text,text)','execute'),'nor the log');
select ok(has_function_privilege('authenticated','public.check_agent_setting(uuid,uuid)','execute'),'a signed-in Member reaches the check, which decides by Role');
select ok(has_function_privilege('authenticated','public.log_agent_setting(uuid,uuid,text,text,text)','execute'),'and the log');
select * from finish();
rollback;
