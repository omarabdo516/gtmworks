begin;
create extension if not exists pgtap with schema extensions;
select plan(36);
-- Omar owns every company. R&S Consultations (2) has no Hermes; Aleem (3) is on the shared bundled `default` profile, as
-- the previous worker left it, and has a Contributor (5); a new company (99) has no Hermes either.
insert into public.companies(id,slug,name) values ('10000000-0000-0000-0000-000000000099','profiles-new','Profiles new');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000001','owner');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select ok((select attach and not move and profile='co-10000000000000000000000000000002' and agent_level=1 and tools_level is null from public.company_profile_work() where company_id='10000000-0000-0000-0000-000000000002'),
 'a company with no Hermes waits for its own profile, named from its id, at level 1');
select is(public.attach_company_profile('10000000-0000-0000-0000-000000000002','http://hermes:8642','encrypted','0.23.0','{run_submission}'),false,'nothing is attached before Hermes made the profile');
select throws_ok($$select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000003',1)$$,'22023','companyProfileInvalid','a company is recorded only on its own profile');
select lives_ok($$select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1)$$,'the worker records the profile Hermes made');
select throws_ok($$select public.attach_company_profile('10000000-0000-0000-0000-000000000002','http://hermes:8642','encrypted','0.23.0','{}')$$,'22023','hermesAgentFailed','a profile that takes no runs is not attached');
select is(public.attach_company_profile('10000000-0000-0000-0000-000000000002','http://hermes:8642','encrypted','0.23.0','{run_submission}'),true,'the company is attached to its own profile');
select is(public.attach_company_profile('10000000-0000-0000-0000-000000000002','http://hermes:8642','encrypted','0.23.0','{run_submission}'),false,'attaching again adds nothing');
-- Aleem and the new company get the shared profile from the previous worker's function.
select cmp_ok(public.provide_bundled_hermes('http://hermes:8642','default','encrypted','0.23.0','{run_submission}'),'>=',2,'the previous worker still provides the shared profile');
select ok((select move and not attach from public.company_profile_work() where company_id='10000000-0000-0000-0000-000000000003'),'a company on the shared profile waits to move');
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003','http://hermes:8642','encrypted','0.23.0','{run_submission}'),0,'nothing moves before its own profile is made');
select lives_ok($$select public.record_company_profile('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003',1)$$,'Aleem''s profile is recorded');
reset role;
-- An open Run of Aleem's Lead holds the move.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) select 'c0000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',id,name
 from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000003';
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values ('10000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000001','Omar','Hello','c1000000-0000-0000-0000-000000000003','run_open');
set local role service_role;
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003','http://hermes:8642','encrypted','0.23.0','{run_submission}'),0,'an open run holds the move');
reset role;
insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
 select '10000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000003','agent',id,name,'Hi','run_open' from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000003';
set local role service_role;
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003','http://hermes:8642','encrypted','0.23.0','{run_submission}'),1,'once the run ended, Aleem''s Lead moves');
reset role;
select is((select string_agg(h.profile||':'||a.name||':'||a.is_default,',') from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.company_id='10000000-0000-0000-0000-000000000003'),
 'co-10000000000000000000000000000003:Lead:true','Aleem''s main agent now runs on Aleem''s own profile');
select is((select count(*)::int from public.hermes_connections where company_id='10000000-0000-0000-0000-000000000003' and profile='default'),0,'the shared Connection no agent uses any more is removed');
select is((select count(distinct h.profile)::int from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.company_id in ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003')),2,
 'two companies run on two different profiles');
select ok(exists(select 1 from public.company_log where company_id='10000000-0000-0000-0000-000000000003' and subject='agent' and action='agent_own_profile'),'the move is in the company''s log');
select ok(not exists(select 1 from public.company_profile_work() where company_id in ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003')),'nothing is left to do for either');
select is(public.forget_company_profile((select connection_id from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000002')),true,'a profile the Engine lost is forgotten');
select ok((select tools_level is null and not attach and not move from public.company_profile_work() where company_id='10000000-0000-0000-0000-000000000002'),'and the worker makes it again');
select lives_ok($$select public.record_company_profile('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1)$$,'once made again it is recorded');
-- Levels: only an Owner, 1 to 3, logged; the worker then rewrites the profile's tools, and no company moves meanwhile.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.set_agent_level('10000000-0000-0000-0000-000000000003',2)$$,'42501','agentLevelNotAllowed','a Contributor cannot change the level');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.set_agent_level('10000000-0000-0000-0000-000000000003',4)$$,'22023','agentLevelInvalid','there are three levels');
select is(public.set_agent_level('10000000-0000-0000-0000-000000000003',2),2,'the Owner sets level 2');
select is((select agent_level::int from public.companies where id='10000000-0000-0000-0000-000000000003'),2,'the company reads its level');
select is((select details->>'old_level'||'>'||(details->>'new_level') from public.company_log where company_id='10000000-0000-0000-0000-000000000003' and action='agent_level_changed'),'1>2','the change is in the log with both levels');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select ok((select tools_level=1 and agent_level=2 and not attach and not move from public.company_profile_work() where company_id='10000000-0000-0000-0000-000000000003'),'the worker sees the profile''s tools lag behind the level');
-- Health: a reading with terminal tools on Aleem's Lead.
select lives_ok($$select public.record_engine_tools((select connection_id from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000003'),'{terminal,file}')$$,'the worker records a reading');
select throws_ok($$select public.record_engine_tools((select connection_id from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000003'),'{browser}')$$,'22023','engineToolsInvalid','only the three risky toolsets are recorded');
select lives_ok($$select public.record_engine_tools((select connection_id from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000002'),'{code_execution}')$$,'and one for the company of one');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select is((select string_agg(agent_name||':'||array_to_string(toolsets,'+'),',') from public.agent_tool_warning('10000000-0000-0000-0000-000000000003')),'Lead:terminal+file','the Owner of a company of two is warned');
select is((select count(*)::int from public.agent_tool_warning('10000000-0000-0000-0000-000000000002')),0,'a company of one person is not');
select is((select profile from public.company_engine_target('10000000-0000-0000-0000-000000000003')),'co-10000000000000000000000000000003','the sign-in target is the company''s own profile');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.agent_tool_warning('10000000-0000-0000-0000-000000000003')),0,'a Contributor is not warned');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.company_engine_target('10000000-0000-0000-0000-000000000003')),0,'a person outside the company learns nothing');
reset role;
set local role anon;
select throws_ok($$select public.set_agent_level('10000000-0000-0000-0000-000000000003',1)$$,'42501',null,'a visitor cannot change a level');
select * from finish();
rollback;
