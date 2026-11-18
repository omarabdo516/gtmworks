begin;
create extension if not exists pgtap with schema extensions;
select plan(34);
-- #124. RS Learning (1): Lead on the Company's own profile through its bundled Connection, the Writer on its own Agent
-- profile, and the Company's shared space. R&S Consultations (2), where the Manager (2) is no member, has the same.
-- The Contributor (5) of RS Learning is made a removed Owner. Only an active Owner records a key change, once, by the
-- provider's name, in company_audit and in the log.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1260000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','e1260000-0000-0000-0000-000000000001','Lead','General',true,'co-10000000000000000000000000000001'),
 ('e1260000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000002','e1260000-0000-0000-0000-000000000002','Lead two','General',true,'co-10000000000000000000000000000002');
insert into public.company_profiles(company_id,profile,tools_level,tools_policy) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy()),
 ('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1,public.engine_tool_policy());
insert into public.company_shared_spaces(company_id,folder) values
 ('10000000-0000-0000-0000-000000000001','/opt/data/profiles/cs-10000000000000000000000000000001/skills'),
 ('10000000-0000-0000-0000-000000000002','/opt/data/profiles/cs-10000000000000000000000000000002/skills');
-- Each Writer on its own profile, written without the guards: the function reads only which profile is whose.
set local session_replication_role=replica;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values
 ('e1260000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001','e1260000-0000-0000-0000-000000000003','Writer','Writes','ag-e1260000000000000000000000000021'),
 ('e1260000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000002','e1260000-0000-0000-0000-000000000004','Writer two','Writes','ag-e1260000000000000000000000000022');
insert into public.agent_profiles(agent_id,company_id) values
 ('e1260000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001'),
 ('e1260000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000002');
update public.members set role='owner',removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local session_replication_role=origin;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select jsonb_agg(jsonb_build_array(profile,kind,agent,name)) from public.company_key_profiles('10000000-0000-0000-0000-000000000001')),
 jsonb_build_array(jsonb_build_array('cs-10000000000000000000000000000001','space',null,null),
  jsonb_build_array('co-10000000000000000000000000000001','company','e1260000-0000-0000-0000-000000000011','Lead'),
  jsonb_build_array('ag-e1260000000000000000000000000021','agent','e1260000-0000-0000-0000-000000000021','Writer')),
 'the space, the Company''s own profile with the Agent that keeps it, and each Agent profile with its Agent, and no other Company''s');
select is((select array_agg(profile order by profile) from public.company_key_profiles('10000000-0000-0000-0000-000000000002')),
 array['ag-e1260000000000000000000000000022','co-10000000000000000000000000000002','cs-10000000000000000000000000000002'],'the other Company''s Owner reads that Company''s own');

select lives_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',true)$$,'the Owner records a key set');
select lives_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',false)$$,'the Owner records a key removed');
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','Open Router',true)$$,'22023','keyInvalid','a provider is named by its slug');
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','sk-or-v1-'||repeat('a',64),true)$$,'22023','keyInvalid','a value as long as a key is no provider');
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001',null,true)$$,'22023','keyInvalid','a change names its provider');
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',null)$$,'22023','keyInvalid','a change is a set or a removal');
select throws_ok($$insert into public.company_audit(company_id,actor_id,action,provider) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','provider_key_set','openrouter')$$,
 '42501',null,'nobody writes a key change by hand');
select lives_ok($$select public.record_unfinished_provider_key('10000000-0000-0000-0000-000000000001','openrouter',array['ag-e1260000000000000000000000000021'])$$,'the Owner keeps the profile a change missed');
select is((select jsonb_agg(jsonb_build_array(provider,profiles)) from public.company_key_unfinished_profiles('10000000-0000-0000-0000-000000000001')),
 jsonb_build_array(jsonb_build_array('openrouter',array['ag-e1260000000000000000000000000021'])),'and reads it back by provider');
select throws_ok($$select public.record_unfinished_provider_key('10000000-0000-0000-0000-000000000001','openrouter',array['ag-e1260000000000000000000000000022'])$$,'22023','keyInvalid','only the Company''s own profiles are kept');
select throws_ok($$select public.record_unfinished_provider_key('10000000-0000-0000-0000-000000000001','openrouter',array['cs-10000000000000000000000000000001'])$$,'22023','keyInvalid','the space is not an Agent profile');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',true)$$,'42501','keyNotAllowed','a Manager cannot set a key');
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',false)$$,'42501','keyNotAllowed','a Manager cannot remove a key');
select throws_ok($$select public.record_unfinished_provider_key('10000000-0000-0000-0000-000000000001','openrouter',array[]::text[])$$,'42501','keyNotAllowed','a Manager cannot change what a change missed');
select is((select count(*)::int from public.company_key_profiles('10000000-0000-0000-0000-000000000002')),0,'a person outside the Company learns none of its profiles');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',true)$$,'42501','keyNotAllowed','a Contributor cannot set a key');
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','anthropic',false)$$,'42501','keyNotAllowed','a Contributor cannot remove a key');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',true)$$,'42501','keyNotAllowed','a Viewer cannot set a key');
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',false)$$,'42501','keyNotAllowed','a Viewer cannot remove a key');
select is((select count(*)::int from public.company_key_profiles('10000000-0000-0000-0000-000000000001')),3,'a Viewer still reads which profiles are the Company''s');
select is((select count(*)::int from public.company_key_unfinished_profiles('10000000-0000-0000-0000-000000000001')),0,'only the Owner reads what a change missed');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',true)$$,'42501','keyNotAllowed','a removed Owner cannot set a key');
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',false)$$,'42501','keyNotAllowed','a removed Owner cannot remove a key');
select is((select count(*)::int from public.company_key_profiles('10000000-0000-0000-0000-000000000001')),0,'nor read the Company''s profiles');
reset role;
set local role anon;
select throws_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',false)$$,'42501',null,'a visitor cannot record a change');
select throws_ok($$select * from public.company_key_profiles('10000000-0000-0000-0000-000000000001')$$,'42501',null,'nor read the profiles');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.record_unfinished_provider_key('10000000-0000-0000-0000-000000000001','openrouter',array[]::text[])$$,'a change that reached every profile');
select is((select count(*)::int from public.company_key_unfinished_profiles('10000000-0000-0000-0000-000000000001')),0,'clears what was missed');
reset role;

select is((select jsonb_agg(jsonb_build_array(actor_id,action,provider) order by id) from public.company_audit
  where company_id='10000000-0000-0000-0000-000000000001' and action in ('provider_key_set','provider_key_removed')),
 jsonb_build_array(jsonb_build_array('20000000-0000-0000-0000-000000000001','provider_key_set','openrouter'),
  jsonb_build_array('20000000-0000-0000-0000-000000000001','provider_key_removed','openrouter')),
 'one audit row per set and removal, by the Owner and the provider; a refusal writes none');
select is((select jsonb_agg(jsonb_build_array(actor_id,actor_kind,action,details) order by id) from public.company_log
  where company_id='10000000-0000-0000-0000-000000000001' and subject='company' and action in ('provider_key_set','provider_key_removed')),
 jsonb_build_array(jsonb_build_array('20000000-0000-0000-0000-000000000001','person','provider_key_set',jsonb_build_object('provider','openrouter')),
  jsonb_build_array('20000000-0000-0000-0000-000000000001','person','provider_key_removed',jsonb_build_object('provider','openrouter'))),
 'one log row per set and removal, naming who did it and the provider and nothing else');
select is((select count(*)::int from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and details::text like '%sk-or-v1-%'),0,'no log row holds anything like a key');
select throws_ok($$insert into public.company_audit(company_id,actor_id,action,provider) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','provider_key_set','sk or key')$$,
 '23514',null,'the table itself refuses a provider that is no slug');
select * from finish();
rollback;
