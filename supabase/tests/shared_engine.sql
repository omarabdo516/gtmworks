begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
-- Omar owns all three companies; 5 is a Contributor of Aleem. RS Learning runs on a profile of its own.
insert into public.hermes_agents(company_id,connection_id,name,speciality,is_default,profile) values ('10000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Mona','Writing',true,'writer');
-- Only R&S Consultations is on the shared bundled profile at first.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.bundled_engine_shared('10000000-0000-0000-0000-000000000002'),false,'no company is on the bundled profile yet');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
-- The previous version's provider put each Company with no Agent on the shared `default` profile (#342 dropped it).
reset role;
insert into public.hermes_agents(company_id,name,speciality,is_default,profile) values ('10000000-0000-0000-0000-000000000002','Lead','General',true,'default');
set local role service_role;
select is((select count(*)::int from public.hermes_agents where profile='default'),1,'one company gets the bundled Engine');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select is(public.bundled_engine_shared('10000000-0000-0000-0000-000000000002'),false,'one company alone on the bundled profile shares nothing');

-- Aleem's agent now runs on the same bundled profile: its memory is shared with R&S Consultations.
reset role;
insert into public.hermes_agents(company_id,connection_id,name,speciality,profile) values ('10000000-0000-0000-0000-000000000003','f1000000-0000-0000-0000-000000000004','Lead','General','default');
set local role authenticated;
select is(public.bundled_engine_shared('10000000-0000-0000-0000-000000000002'),true,'the Owner of a company sharing the bundled profile is told');
select is(public.bundled_engine_shared('10000000-0000-0000-0000-000000000003'),true,'so is the Owner of the other one');
select is(public.bundled_engine_shared('10000000-0000-0000-0000-000000000001'),false,'a company on a profile of its own shares nothing');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.bundled_engine_shared('10000000-0000-0000-0000-000000000003'),false,'a Contributor is not told');
reset role;
set local role anon;
select throws_ok($$select public.bundled_engine_shared('10000000-0000-0000-0000-000000000003')$$,'42501',null,'a visitor cannot ask');
select * from finish();
rollback;
