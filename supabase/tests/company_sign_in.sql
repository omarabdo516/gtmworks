begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
-- #384, ADR 0018 (Sign-in). A subscription is signed in once on the root profile of the Company's own Engine, and
-- the database answers which Engine profiles are that Company's, so the app can remove an older sign-in an earlier
-- version left in one of them and no other Company's. RS Learning (1): a Company profile, and the profile record of one
-- Agent; R&S Consultations (2): a Company with an Agent profile and no Company profile yet. Only the Owner records a
-- subscription's connect and disconnect, each once, in the Company's log by its provider.
insert into public.company_profiles(company_id,profile,tools_confirmed) values ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',true);
-- The profile records alone, without their Agents: the target reads only which profile is whose.
set local session_replication_role=replica;
insert into public.agent_profiles(agent_id,company_id) values
 ('e1240000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('e1240000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
set local session_replication_role=origin;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select profile from public.company_engine_target('10000000-0000-0000-0000-000000000001')),
 'co-10000000000000000000000000000001','the target names the Company''s own profile');
select is((select profiles from public.company_engine_target('10000000-0000-0000-0000-000000000001')),
 array['co-10000000000000000000000000000001','ag-e1240000000000000000000000000001'],'and every profile of the Company, and no other Company''s');
-- A Company with no Company profile yet still has a target: its sign-in is on its Engine's root profile, and the
-- profiles it names are the ones an older version could have left a sign-in in.
select is((select profile from public.company_engine_target('10000000-0000-0000-0000-000000000002')),null,'a Company with no profile of its own has a null profile');
select is((select profiles from public.company_engine_target('10000000-0000-0000-0000-000000000002')),
 array['ag-e1240000000000000000000000000002'],'and names the Agent profiles it does have');

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
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.company_engine_target('10000000-0000-0000-0000-000000000002')),0,'a person outside the Company learns nothing');
reset role;
set local role anon;
select throws_ok($$select public.record_subscription_change('10000000-0000-0000-0000-000000000001','openai-codex',false)$$,'42501',null,'a visitor cannot record a change');
reset role;
select is((select jsonb_agg(jsonb_build_array(actor_id,actor_kind,action,details) order by id) from public.company_log
  where company_id='10000000-0000-0000-0000-000000000001' and subject='company' and action in ('subscription_connected','subscription_disconnected') and created_at>=now()),
 jsonb_build_array(jsonb_build_array('20000000-0000-0000-0000-000000000001','person','subscription_connected',jsonb_build_object('provider','openai-codex')),
  jsonb_build_array('20000000-0000-0000-0000-000000000001','person','subscription_disconnected',jsonb_build_object('provider','openai-codex'))),
 'one log row per connect and disconnect, naming who did it and the provider; a sign-in is logged once and a refusal not at all');
select * from finish();
rollback;
