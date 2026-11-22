begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- #622 (spec #611). The Company's Fallback model: RS Learning (1) has the Owner (1), a Manager (2), a Contributor (3) and
-- a Viewer (4); R&S Consultations (2) has only the Owner, so Aleem's Owner (5) is no Member there. Only the Owner picks a
-- model or None; every Member reads their own Company's choice only; the worker's list names it with every profile the
-- Company's Agents run on.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.set_company_fallback_model('10000000-0000-0000-0000-000000000001','anthropic','claude-sonnet-4-6'),'anthropic/claude-sonnet-4-6','the Owner picks a Fallback model');
select is(public.set_company_fallback_model('10000000-0000-0000-0000-000000000001','openrouter','anthropic/claude-opus-4.6'),'openrouter/anthropic/claude-opus-4.6','and another, which replaces it');
select is((select count(*)::int from public.company_fallback_models where company_id='10000000-0000-0000-0000-000000000001'),1,'one choice a Company');
select is((select changed_by from public.company_fallback_models),'20000000-0000-0000-0000-000000000001'::uuid,'the choice names who made it');
select throws_ok($$select public.set_company_fallback_model('10000000-0000-0000-0000-000000000001','Anthropic','claude')$$,'22023',null,'a provider is the Engine''s id');
select throws_ok($$select public.set_company_fallback_model('10000000-0000-0000-0000-000000000001','anthropic',null)$$,'22023',null,'a choice names a model');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.set_company_fallback_model('10000000-0000-0000-0000-000000000001',null,null)$$,'42501',null,'a Manager cannot change it');
select is((select provider||'/'||model from public.company_fallback_models),'openrouter/anthropic/claude-opus-4.6','but reads it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.set_company_fallback_model('10000000-0000-0000-0000-000000000001','anthropic','claude-sonnet-4-6')$$,'42501',null,'nor can a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.set_company_fallback_model('10000000-0000-0000-0000-000000000001',null,null)$$,'42501',null,'nobody changes another Company''s choice');
select is((select count(*)::int from public.company_fallback_models),0,'or reads it');
select throws_ok($$select * from public.fallback_model_work()$$,'42501',null,'the worker''s list is not a Member''s');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.set_company_fallback_model('10000000-0000-0000-0000-000000000001',null,null),null,'the Owner picks None again');
reset role;
select is((select array[w.provider,w.model] from public.fallback_model_work() w where w.company_id='10000000-0000-0000-0000-000000000001'),array[null,null]::text[],
 'and the worker''s list then holds no model for it');
select * from finish();
rollback;
