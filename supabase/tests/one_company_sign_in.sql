begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
-- #123, ADR 0016 (Sign-in). RS Learning (1): Lead on the Company's own profile through its bundled Connection, and the
-- profile record of one more Agent; RS Consultations (2) has an Agent profile of its own. The seed has three Companies.
-- Only the Owner records a subscription's connect and disconnect, each once, in the Company's log by its provider.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('e1230000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e1230000-0000-0000-0000-000000000001','Lead','General',true,'co-10000000000000000000000000000001');
insert into public.company_profiles(company_id,profile,tools_level,tools_policy) values ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy());
-- The profile records alone, without their Agents: the target reads only which profile is whose.
set local session_replication_role=replica;
insert into public.agent_profiles(agent_id,company_id) values
 ('e1240000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('e1240000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
set local session_replication_role=origin;

select is(public.install_has_one_company(),false,'the seed''s install has several Companies');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select profiles from public.company_engine_target('10000000-0000-0000-0000-000000000001')),
 array['co-10000000000000000000000000000001','ag-e1240000000000000000000000000001'],'the target names every profile of the Company, and no other Company''s');
select is((select one_company from public.company_engine_target('10000000-0000-0000-0000-000000000001')),false,'and says the install has several Companies');

select lives_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','openai-codex',true,'session-owner-0001')$$,'the Owner records a finished sign-in');
select lives_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','openai-codex',true,'session-owner-0001')$$,'the same sign-in again');
select lives_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','openai-codex',false)$$,'the Owner records a disconnect');
select throws_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','gemini',true)$$,'22023','signInInvalid','a subscription is ChatGPT or Claude');
select throws_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','openai-codex',true,'a b')$$,'22023','signInInvalid','a session is the Engine''s id');
select throws_ok($$insert into public.company_audit(company_id,actor_id,action,provider) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','subscription_connected','openai-codex')$$,
 '42501',null,'nobody writes a connect by hand');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','openai-codex',true,'session-manager-01')$$,'42501','signInNotAllowed','a Manager cannot connect');
select throws_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','openai-codex',false)$$,'42501','signInNotAllowed','a Manager cannot disconnect');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','openai-codex',true,'session-contrib-01')$$,'42501','signInNotAllowed','a Contributor cannot connect');
select throws_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','anthropic',false)$$,'42501','signInNotAllowed','a Contributor cannot disconnect');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','openai-codex',true,'session-viewer-001')$$,'42501','signInNotAllowed','a Viewer cannot connect');
select throws_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','openai-codex',false)$$,'42501','signInNotAllowed','a Viewer cannot disconnect');
select is((select count(*)::int from public.company_engine_target('10000000-0000-0000-0000-000000000001')),1,'a Viewer still reads where the sign-in is');
reset role;
set local role anon;
select throws_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','openai-codex',false)$$,'42501',null,'a visitor cannot record a change');
reset role;
select is((select jsonb_agg(jsonb_build_array(actor_id,actor_kind,action,details) order by id) from public.company_log
  where company_id='10000000-0000-0000-0000-000000000001' and subject='company' and action in ('subscription_connected','subscription_disconnected') and created_at>=now()),
 jsonb_build_array(jsonb_build_array('20000000-0000-0000-0000-000000000001','person','subscription_connected',jsonb_build_object('provider','openai-codex')),
  jsonb_build_array('20000000-0000-0000-0000-000000000001','person','subscription_disconnected',jsonb_build_object('provider','openai-codex'))),
 'one log row per connect and disconnect, naming who did it and the provider; a sign-in is logged once and a refusal not at all');

-- The other two Companies go, and the install has one; then a second Company is made.
set local session_replication_role=replica;
delete from public.companies where id<>'10000000-0000-0000-0000-000000000001';
set local session_replication_role=origin;
select is(public.install_has_one_company(),true,'an install with one Company');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select one_company from public.company_engine_target('10000000-0000-0000-0000-000000000001')),true,'its Company''s target says so');
select is((select profiles from public.company_engine_target('10000000-0000-0000-0000-000000000001')),
 array['co-10000000000000000000000000000001','ag-e1240000000000000000000000000001'],'and names the same profiles');
reset role;
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000005','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('e1250000-0000-0000-0000-000000000001','second-company','Second Company','e3821000-0000-4000-8000-000000000005');
select is(public.install_has_one_company(),false,'a second Company ends it');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select one_company from public.company_engine_target('10000000-0000-0000-0000-000000000001')),false,'and the first Company''s target says so on its next read');
reset role;
select ok(not has_function_privilege('authenticated','public.install_has_one_company()','execute'),'no client asks the database directly');
select * from finish();
rollback;
