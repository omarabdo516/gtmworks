begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
-- #619 (spec #611). The Owner puts the Company's Providers in order and switches one off and on again; its place and its
-- name stay. Every Member reads the order, only the Owner changes it, and no other Company reads or changes it.
-- RS Learning (1): Omar is its Owner (…01), …02 a Manager, …04 a Viewer; …02 is no Member of R&S Consultations (2),
-- whose Owner is …01 too.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.order_providers('10000000-0000-0000-0000-000000000001',
 '[{"provider":"openai-codex","account":"61b59d"},{"provider":"anthropic","account":"key"},{"provider":"openai-codex","account":"86c091"}]')$$,'the Owner orders three Providers');
select is((select jsonb_agg(jsonb_build_array(provider,account,place,enabled) order by place) from public.provider_order where company_id='10000000-0000-0000-0000-000000000001'),
 '[["openai-codex","61b59d",0,true],["anthropic","key",1,true],["openai-codex","86c091",2,true]]'::jsonb,'each keeps its place, switched on');
select is(public.switch_provider('10000000-0000-0000-0000-000000000001','openai-codex','61b59d',false),false,'the Owner switches the first off');
select lives_ok($$select public.order_providers('10000000-0000-0000-0000-000000000001',
 '[{"provider":"anthropic","account":"key"},{"provider":"openai-codex","account":"61b59d"}]')$$,'and orders again, naming two');
select is((select jsonb_agg(jsonb_build_array(provider,account,place,enabled) order by provider,account) from public.provider_order where company_id='10000000-0000-0000-0000-000000000001'),
 '[["anthropic","key",0,true],["openai-codex","61b59d",1,false],["openai-codex","86c091",null,true]]'::jsonb,
 'a switched-off Provider keeps its switch when it moves; one left out loses its place only');
select is(public.switch_provider('10000000-0000-0000-0000-000000000001','openai-codex','61b59d',true),true,'and switches it on again');
select is((select place from public.provider_order where company_id='10000000-0000-0000-0000-000000000001' and account='61b59d'),1,'in its place');
select throws_ok($$select public.order_providers('10000000-0000-0000-0000-000000000001','[{"provider":"anthropic","account":"key"},{"provider":"anthropic","account":"key"}]')$$,
 '22023','providerOrderInvalid','a Provider has one place');
select throws_ok($$select public.order_providers('10000000-0000-0000-0000-000000000001','[{"provider":"anthropic","account":"86 c091"}]')$$,'22023','providerOrderInvalid','an account is the Engine''s id');
select throws_ok($$select public.order_providers('10000000-0000-0000-0000-000000000001','[]')$$,'22023','providerOrderInvalid','an order names a Provider');
select throws_ok($$select public.switch_provider('10000000-0000-0000-0000-000000000001','anthropic','key',null)$$,'22023','providerOrderInvalid','a switch is on or off');
select throws_ok($$update public.provider_order set enabled=false where company_id='10000000-0000-0000-0000-000000000001'$$,'42501',null,'nobody switches one by hand');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.provider_order where company_id='10000000-0000-0000-0000-000000000001'),3,'a Manager reads the order');
select throws_ok($$select public.switch_provider('10000000-0000-0000-0000-000000000001','anthropic','key',false)$$,'42501','providerNotAllowed','a Manager cannot switch one off');
select throws_ok($$select public.order_providers('10000000-0000-0000-0000-000000000001','[{"provider":"openai-codex","account":"86c091"}]')$$,'42501','providerNotAllowed','nor reorder');
select throws_ok($$select public.forget_provider('10000000-0000-0000-0000-000000000001','anthropic','key')$$,'42501','providerNotAllowed','nor forget one');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.switch_provider('10000000-0000-0000-0000-000000000002','anthropic','key',false)$$,'42501','providerNotAllowed','nor does a Viewer, in a Company they are not in');

-- The second Company: its Owner's change there stays there, and a Member of the first reads nothing of it.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.switch_provider('10000000-0000-0000-0000-000000000002','anthropic','key',false);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select jsonb_agg(jsonb_build_array(company_id,account,place,enabled) order by account) from public.provider_order),
 '[["10000000-0000-0000-0000-000000000001","61b59d",1,true],["10000000-0000-0000-0000-000000000001","86c091",null,true],["10000000-0000-0000-0000-000000000001","key",0,true]]'::jsonb,
 'a Member of the first Company reads its order only, unchanged by the second''s');
-- A removed Provider takes its place and switch with it.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.forget_provider('10000000-0000-0000-0000-000000000001','openai-codex','61b59d');
select is((select count(*)::int from public.provider_order where company_id='10000000-0000-0000-0000-000000000001' and account='61b59d'),0,'the Owner forgets a removed Provider''s place');
reset role;
select * from finish();
rollback;
