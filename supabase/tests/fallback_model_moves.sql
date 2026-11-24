begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
-- #644 (spec #611). The Company's Engine moved a request to the Company's Fallback model: the worker logs it once per
-- Run, as gtmworks's own entry naming the model the Run was to run on and the one that answered. RS Learning (1) has
-- Claude Sonnet as its Fallback model; R&S Consultations (2) has None. …02 is a Manager of RS Learning only.
insert into public.company_fallback_models(company_id,provider,model) values ('10000000-0000-0000-0000-000000000001','anthropic','claude-sonnet-4-6');
set local role service_role;
select is(public.record_fallback_move('10000000-0000-0000-0000-000000000001','run_1','openai-codex','gpt-5.5','anthropic','claude-sonnet-4-6'),
 true,'the worker logs a move to the Fallback model');
select is(public.record_fallback_move('10000000-0000-0000-0000-000000000001','run_1','openai-codex','gpt-5.5','anthropic','claude-sonnet-4-6'),
 false,'a Run read again is not logged again');
select is((select count(*)::int from public.company_fallback_models),1,'the worker reads the Company''s choice');
select throws_ok($$select public.record_fallback_move('10000000-0000-0000-0000-000000000002','run_2','openai-codex','gpt-5.5','anthropic','claude-sonnet-4-6')$$,
 '22023','fallbackMoveInvalid','a Company with None has no move to a Fallback model');
select throws_ok($$select public.record_fallback_move('10000000-0000-0000-0000-000000000001','run_3','openai-codex','gpt-5.5','openrouter','some-model')$$,
 '22023','fallbackMoveInvalid','an answer from another provider is no move to the Fallback model');
select throws_ok($$select public.record_fallback_move('10000000-0000-0000-0000-000000000001','run_4','anthropic','claude-sonnet-4-6','anthropic','claude-sonnet-4-6')$$,
 '22023','fallbackMoveInvalid','a Run answered by the model it was to run on is no move');
reset role;
select is((select jsonb_agg(jsonb_build_array(actor_kind,actor_id,subject,details))
  from public.company_log where action='fallback_model_used'),
 '[["system",null,"company",{"from_provider":"openai-codex","from_model":"gpt-5.5","to_provider":"anthropic","to_model":"claude-sonnet-4-6"}]]'::jsonb,
 'one entry, gtmworks''s own, in RS Learning''s log, naming the two models and no secret');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.record_fallback_move('10000000-0000-0000-0000-000000000001','run_5','openai-codex','gpt-5.5','anthropic','claude-sonnet-4-6')$$,
 '42501',null,'no signed-in person logs a move');
select is((select count(*)::int from public.company_log where action='fallback_model_used'),1,'a Member of the Company reads the entry');
reset role;
select * from finish();
rollback;
