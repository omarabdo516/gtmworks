begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- #620 (spec #611). Each Provider's model switches: RS Learning (1) has the Owner (1), a Manager (2), a Contributor (3)
-- and a Viewer (4); R&S Consultations (2) has only the Owner, so the Contributor of RS Learning and Aleem (5) is no
-- Member there. Only the Owner turns a model on or off; every Member reads the switches of their own Company only.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.set_provider_model('10000000-0000-0000-0000-000000000001','sub-anthropic','claude-opus-4-6',false),false,'the Owner turns a model off on one Provider');
select is(public.set_provider_model('10000000-0000-0000-0000-000000000001','key-anthropic','claude-opus-4-6',true),true,'and keeps it on for another of the same kind');
select is(public.set_provider_model('10000000-0000-0000-0000-000000000001','sub-anthropic','claude-opus-4-6',true),true,'turns it on again');
select is((select enabled from public.company_provider_models where company_id='10000000-0000-0000-0000-000000000001' and entry='sub-anthropic' and model='claude-opus-4-6'),true,
 'and one switch is kept per Provider and model');
select is((select count(*)::int from public.company_provider_models where company_id='10000000-0000-0000-0000-000000000001'),2,'one row for each Provider''s model');
select is((select changed_by from public.company_provider_models where entry='sub-anthropic'),'20000000-0000-0000-0000-000000000001'::uuid,'the change names who made it');
select is(public.set_provider_model('10000000-0000-0000-0000-000000000002','key-openrouter','openai/gpt-5.5',false),false,'the Owner of another Company keeps its own');
select throws_ok($$select public.set_provider_model('10000000-0000-0000-0000-000000000001','anthropic','claude-opus-4-6',false)$$,'22023',null,'a Provider is named by its kind and provider id');
select throws_ok($$select public.set_provider_model('10000000-0000-0000-0000-000000000001','key-anthropic','claude opus',false)$$,'22023',null,'a model is one word');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.set_provider_model('10000000-0000-0000-0000-000000000001','sub-anthropic','claude-opus-4-6',false)$$,'42501',null,'a Manager cannot change a switch');
select is((select count(*)::int from public.company_provider_models),2,'but reads the Company''s switches');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.set_provider_model('10000000-0000-0000-0000-000000000001','sub-anthropic','claude-opus-4-6',false)$$,'42501',null,'nor can a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.set_provider_model('10000000-0000-0000-0000-000000000002','key-openrouter','openai/gpt-5.5',true)$$,'42501',null,'nobody changes another Company''s switches');
select is((select count(*)::int from public.company_provider_models where company_id='10000000-0000-0000-0000-000000000002'),0,'or reads them');
reset role;
select * from finish();
rollback;
