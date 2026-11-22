begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
-- #621 (spec #611). The Company's Engine moved a request from one subscription account to the next: the worker copies
-- each move into the Company's log once, as gtmworks's own entry, with the two accounts' names. RS Learning (1): Omar
-- (…01) is its Owner, …02 a Manager who is no Member of R&S Consultations (2).
set local role service_role;
select is(public.record_provider_switches('10000000-0000-0000-0000-000000000001',
 '[{"id":"0123456789abcdef0123456789abcdef","provider":"openai-codex","from":"c0dex1","to":"c0dex2","from_name":"ChatGPT · Said","to_name":"ChatGPT 2","at":1795000000.5},
   {"id":"fedcba9876543210fedcba9876543210","provider":"anthropic","from":"c1aude","to":"c2aude","from_name":"Claude","to_name":"Claude 2","at":99999999999}]'),
 2,'the worker copies two moves');
select is(public.record_provider_switches('10000000-0000-0000-0000-000000000001',
 '[{"id":"0123456789abcdef0123456789abcdef","provider":"openai-codex","from":"c0dex1","to":"c0dex2","from_name":"ChatGPT · Said","to_name":"ChatGPT 2","at":1795000000.5}]'),
 0,'a move read again is not copied again');
-- R&S Consultations' own Engine moved one request too.
select public.record_provider_switches('10000000-0000-0000-0000-000000000002',
 '[{"id":"55555555555555555555555555555555","provider":"openai-codex","from":"other1","to":"other2","from_name":"ChatGPT","to_name":"ChatGPT 2","at":1795000000}]');
select throws_ok($$select public.record_provider_switches('10000000-0000-0000-0000-000000000001',
 '[{"id":"11111111111111111111111111111111","provider":"openai-codex","from":"c0dex1","to":"c0dex2","from_name":"ChatGPT","to_name":"ChatGPT 2","at":1795000000},
   {"id":"22222222222222222222222222222222","provider":"openrouter","from":"key","to":"c0dex2","from_name":"OpenRouter","to_name":"ChatGPT 2","at":1795000000}]')$$,
 '22023','providerSwitchInvalid','a move that is no subscription''s is refused');
select throws_ok($$select public.record_provider_switches('10000000-0000-0000-0000-000000000001',
 '[{"id":"33333333333333333333333333333333","provider":"openai-codex","from":"c0dex1","to":"c0dex1","from_name":"ChatGPT","to_name":"ChatGPT","at":1795000000}]')$$,
 '22023','providerSwitchInvalid','a move goes to another account');
select throws_ok($$select public.record_provider_switches('10000000-0000-0000-0000-000000000001','[{"id":"nope","at":1}]')$$,
 '22023','providerSwitchInvalid','a move carries the Engine''s id for it');
-- What was kept, read as the database owner: no Role reads company_audit itself.
reset role;
select is((select count(*)::int from public.company_audit where switch_id in ('11111111111111111111111111111111','22222222222222222222222222222222')),0,
 'a refused list copies nothing');
select is((select jsonb_agg(jsonb_build_array(actor_kind,actor_id,subject,details) order by details->>'provider' desc)
  from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and action='provider_switched'),
 '[["system",null,"company",{"provider":"openai-codex","from_name":"ChatGPT · Said","to_name":"ChatGPT 2"}],
   ["system",null,"company",{"provider":"anthropic","from_name":"Claude","to_name":"Claude 2"}]]'::jsonb,
 'each is gtmworks''s own entry in the Company''s log, naming the two accounts and no secret');
select is((select created_at from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and action='provider_switched' and details->>'provider'='openai-codex'),
 to_timestamp(1795000000.5),'at the Engine''s time');
select ok((select created_at<=now() from public.company_log where action='provider_switched' and details->>'provider'='anthropic'),'never later than now');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.record_provider_switches('10000000-0000-0000-0000-000000000002',
 '[{"id":"44444444444444444444444444444444","provider":"openai-codex","from":"a","to":"b","from_name":"ChatGPT","to_name":"ChatGPT 2","at":1}]')$$,
 '42501',null,'no signed-in person copies a move');
select is((select jsonb_agg(distinct company_id) from public.company_log where action='provider_switched'),'["10000000-0000-0000-0000-000000000001"]'::jsonb,
 'a Member reads their own Company''s moves and none of another''s');
-- What the worker gives the Engine: the Owner's switch and name of each Provider, by Company.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.switch_provider('10000000-0000-0000-0000-000000000001','openai-codex','c0dex1',false);
select public.rename_provider('10000000-0000-0000-0000-000000000001','openai-codex','c0dex2','ChatGPT · Omar');
select throws_ok($$select * from public.provider_accounts_work()$$,'42501',null,'no signed-in person reads every Company''s accounts');
set local role service_role;
select is((select accounts from public.provider_accounts_work() where company_id='10000000-0000-0000-0000-000000000001'),
 '[{"provider":"openai-codex","account":"c0dex1","ordered":true,"place":null,"enabled":false,"name":null},{"provider":"openai-codex","account":"c0dex2","ordered":false,"place":null,"enabled":true,"name":"ChatGPT · Omar"}]'::jsonb,
 'the worker reads each Provider''s place, switch and name, for its own Company');
reset role;
select * from finish();
rollback;
