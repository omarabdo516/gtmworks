begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
-- RS Learning already has a pasted Connection; the other two companies have no Hermes yet.
insert into public.hermes_connections(id,company_id,agency_owner_id,address,profile,key_encrypted,state) values ('f0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','writer','ciphertext','connected');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.provide_bundled_hermes('http://hermes:8642','default','encrypted','0.23.0','{run_submission}')$$,'42501',null,'a person cannot provide the bundled Hermes, even an Agency owner');
select throws_ok($$select public.bundled_hermes_waiting()$$,'42501',null,'a person cannot ask whether a company waits for it');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.bundled_hermes_waiting(),true,'companies without Hermes are waiting');
select throws_ok($$select public.provide_bundled_hermes('http://hermes:8642','default','encrypted','0.23.0','{}')$$,'22023','hermesAgentFailed','a Hermes that takes no runs is not provided');
select is(public.provide_bundled_hermes('http://hermes:8642','default','encrypted','0.23.0','{run_submission,run_events_sse}'),2,'each company without Hermes is provided once');
select is(public.provide_bundled_hermes('http://hermes:8642','default','encrypted','0.23.0','{run_submission}'),0,'providing again adds nothing');
select is(public.bundled_hermes_waiting(),false,'no company is waiting any more');
reset role;
select is((select string_agg(h.company_id||':'||h.agency_owner_id||':'||h.address||':'||h.profile||':'||h.state||':'||a.name||':'||a.is_default,',' order by h.company_id) from public.hermes_connections h join public.hermes_agents a on a.connection_id=h.id where h.address='http://hermes:8642'),
 '10000000-0000-0000-0000-000000000002:20000000-0000-0000-0000-000000000001:http://hermes:8642:default:connected:Lead:true,10000000-0000-0000-0000-000000000003:20000000-0000-0000-0000-000000000001:http://hermes:8642:default:connected:Lead:true',
 'the Agency owner owns a connected bundled Connection with a main agent named Lead in each new company');
select is((select string_agg(a.company_id||':'||a.name||':'||a.is_default,',' order by a.company_id) from public.hermes_agents a where a.company_id in ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003')),
 '10000000-0000-0000-0000-000000000002:Lead:true,10000000-0000-0000-0000-000000000003:Lead:true',
 'each company given the bundled Engine has exactly one agent, Lead, flagged main');
select is((select count(*)::int from public.hermes_connections where company_id='10000000-0000-0000-0000-000000000001'),1,'a company with a pasted Connection keeps only it');
select * from finish();
rollback;
