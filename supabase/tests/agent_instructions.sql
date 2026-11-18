begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
-- #176: an Agent's standing instructions, saved from its page in Settings, are checked by the database before the Engine
-- is written: the Owner of the Company alone, an Agent of that Company, and one they see. A save logs one row naming who,
-- the Agent and the field; the text itself never reaches the row.
-- RS Learning: 1 Owner, 2 Manager, 3 Contributor, 4 Viewer; Aleem (…0003) is another Company.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-0000000000b1','Probe','Writing',false,'ab-probe'),
 ('e1000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-0000000000b3','Elsewhere','Writing',false,'ab-elsewhere');
-- Probe is shown to the Manager, the Contributor and the Viewer (#15); the Owner sees every Agent.
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e1000000-0000-0000-0000-0000000000b1' from generate_series(2,4) n;
create function pg_temp.instructions_rows() returns bigint language sql security definer as $$
 select count(*) from public.company_log where action='agent_setting_changed';
$$;
grant execute on function pg_temp.instructions_rows() to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.check_agent_owner_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1')$$,'the Owner may change the instructions of an Agent of the Company');
select public.log_agent_instructions('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1');
select is((select jsonb_build_array(actor_id,actor_kind,subject,agent_id,action,details) from public.company_log where action='agent_setting_changed' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000001','person','agent','e1000000-0000-0000-0000-0000000000b1','agent_setting_changed',
  jsonb_build_object('agent_name','Probe','field','instructions')),'the instructions write one row: who, the Agent and the field, with no text');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.check_agent_owner_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1')$$,'42501','agentSettingNotAllowed','a Manager may not change the instructions');
select throws_ok($$select public.log_agent_instructions('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1')$$,'42501','agentSettingNotAllowed','nor log them');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.check_agent_owner_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1')$$,'42501','agentSettingNotAllowed','a Contributor may not');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.log_agent_instructions('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1')$$,'42501','agentSettingNotAllowed','nor a Viewer');
select is(pg_temp.instructions_rows(),1::bigint,'refused changes write no row');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.check_agent_owner_setting('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b3')$$,'42501','agentSettingNotAllowed','an Agent of another Company is refused');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.log_agent_instructions('10000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-0000000000b3')$$,'42501','agentSettingNotAllowed','and a Manager of one Company writes nothing in another');
reset role;
select ok(not has_function_privilege('anon','public.check_agent_owner_setting(uuid,uuid)','execute'),'no signed-out caller reaches the check');
select ok(not has_function_privilege('anon','public.log_agent_instructions(uuid,uuid)','execute'),'nor the log');
select ok(has_function_privilege('authenticated','public.check_agent_owner_setting(uuid,uuid)','execute'),'a signed-in Member reaches the check, which decides the Owner alone');
select ok(has_function_privilege('authenticated','public.log_agent_instructions(uuid,uuid)','execute'),'and the log');
select * from finish();
rollback;
