begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
-- #28: an Agent's own learning mode is remembered apart from the Engine's two approvals: the Owner sets "auto" or "ask"
-- for one Agent, or clears it so the Agent follows the Company, and a member reads each Agent's choice.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e9200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','e9200000-0000-0000-0000-000000000011','Solo','Writing',false,'co-10000000000000000000000000000001');
insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) values
 ('e9200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1,public.engine_tool_policy());

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_agent_learning_mode('e9200000-0000-0000-0000-000000000001','auto')$$,'the Owner gives one Agent its own mode');
select is((select learning_mode_choice from public.company_learning_modes('10000000-0000-0000-0000-000000000001') where agent='e9200000-0000-0000-0000-000000000001'),'auto','the member reads the Agent''s own choice');
select lives_ok($$select public.set_agent_learning_mode('e9200000-0000-0000-0000-000000000001',null)$$,'the Owner gives it back to the Company');
select is((select learning_mode_choice from public.company_learning_modes('10000000-0000-0000-0000-000000000001') where agent='e9200000-0000-0000-0000-000000000001'),null,'no choice is kept, so it follows the Company');
select throws_ok($$select public.set_agent_learning_mode('e9200000-0000-0000-0000-000000000001','sometimes')$$,'22023','learningModeInvalid','a mode this version does not know is refused');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.set_agent_learning_mode('e9200000-0000-0000-0000-000000000001','ask')$$,'42501','settingNotAllowed','a Manager chooses no mode');
reset role;
select ok(has_function_privilege('authenticated','public.company_learning_modes(uuid)','execute'),'a signed-in Member reads the choices');
select ok(not has_function_privilege('service_role','public.set_agent_learning_mode(uuid,text)','execute'),'and no service caller sets one');
select * from finish();
rollback;
