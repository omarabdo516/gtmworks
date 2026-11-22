begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
-- #618 (spec #611). The Owner names each of the Company's Providers: two ChatGPT subscriptions apart by the Engine's
-- entry id, and a key by `key`. Every Member reads the names, only the Owner writes one, and no other Company reads or
-- changes them. RS Learning (1): Omar is its Owner (…01), …02 a Manager, …03 a Contributor, …04 a Viewer; …02 is no
-- Member of R&S Consultations (2), whose Owner is …01 too.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000001','openai-codex','86c091','ChatGPT · Said')$$,'the Owner names the first ChatGPT');
select lives_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000001','openai-codex','61b59d','  ChatGPT · Omar ')$$,'and the second, trimmed');
select lives_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000001','anthropic','key','Anthropic key')$$,'and a key');
select lives_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000001','openai-codex','86c091','ChatGPT · Said (work)')$$,'a rename replaces the name');
select is((select jsonb_agg(jsonb_build_array(provider,account,name) order by provider,account) from public.provider_names where company_id='10000000-0000-0000-0000-000000000001'),
 '[["anthropic","key","Anthropic key"],["openai-codex","61b59d","ChatGPT · Omar"],["openai-codex","86c091","ChatGPT · Said (work)"]]'::jsonb,
 'each Provider keeps its own name; two of one kind stay apart');
select throws_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000001','openai-codex','86c091',repeat('a',61))$$,'22023','providerNameInvalid','a name is at most 60 characters');
select throws_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000001','openai-codex','86 c091','x')$$,'22023','providerNameInvalid','an account is the Engine''s id');
select throws_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000001','openai-codex','86c091',E'a\nb')$$,'22023','providerNameInvalid','a name has no control characters');
select throws_ok($$insert into public.provider_names(company_id,provider,account,name) values ('10000000-0000-0000-0000-000000000001','anthropic','x1','By hand')$$,'42501',null,'nobody writes a name by hand');
select throws_ok($$update public.provider_names set name='By hand' where company_id='10000000-0000-0000-0000-000000000001'$$,'42501',null,'nor changes one by hand');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.provider_names where company_id='10000000-0000-0000-0000-000000000001'),3,'a Manager reads the names');
select throws_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000001','openai-codex','86c091','Manager''s')$$,'42501','providerNotAllowed','a Manager cannot rename');
select throws_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000002','openai-codex','86c091','Elsewhere')$$,'42501','providerNotAllowed','nor rename in a Company they are not in');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000001','anthropic','key','Viewer''s')$$,'42501','providerNotAllowed','a Viewer cannot rename');

-- The second Company: its own names, and none of the first Company's.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000002','openai-codex','86c091','Other Company')$$,'a second Company names an entry of the same id apart');
select lives_ok($$select public.rename_provider('10000000-0000-0000-0000-000000000001','anthropic','key','')$$,'an empty name gives back the kind''s name');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select jsonb_agg(jsonb_build_array(company_id,provider,account,name) order by provider,account) from public.provider_names),
 '[["10000000-0000-0000-0000-000000000001","openai-codex","61b59d","ChatGPT · Omar"],["10000000-0000-0000-0000-000000000001","openai-codex","86c091","ChatGPT · Said (work)"]]'::jsonb,
 'a Member of the first Company reads its names only, the key''s name given back, and nothing of the second');
reset role;
select * from finish();
rollback;
