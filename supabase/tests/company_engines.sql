begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- #380: one Engine record per Company, readable by server code alone, and a Company is made only onto a waiting record.
select ok(to_regclass('public.company_engines') is not null,'the Engine record is a table');
select ok((select relrowsecurity from pg_class where oid='public.company_engines'::regclass),'it has row-level security on');
select ok(not has_table_privilege('anon','public.company_engines','select'),'a signed-out visitor reads nothing');
select ok(not has_table_privilege('authenticated','public.company_engines','select'),'no Member holds a grant on it');
select ok(has_table_privilege('service_role','public.company_engines','select'),'only the server role reads it');
select ok(exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
 where i.indrelid='public.company_engines'::regclass and i.indisunique and a.attname='company_id'),'one record per Company');
-- The Owner of a Company cannot read even its own Engine's key, and no query can tell another Company's record exists.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select count(*) from public.company_engines$$,'42501',null,'the Owner, like every Member, reads no Engine record');
reset role;
set local role service_role;
select ok((select count(*) from public.company_engines)>0,'the server role reads the Engine records');
reset role;
-- A Company cannot be made without an Engine record to attach to: with none waiting the insert fails and leaves nothing.
delete from public.company_engines where company_id is null;
select throws_ok($$insert into public.companies(id,slug,name) values ('1fed0000-0000-0000-0000-000000000001','engine-missing','No Engine')$$,
 '55000','companyEngineMissing','a Company cannot be made without an Engine record');
select is((select count(*)::int from public.companies where slug='engine-missing'),0,'the refused Company left nothing behind');
insert into public.company_engines(address,key_encrypted) values ('http://hermes:8642','cipher');
insert into public.companies(id,slug,name) values ('1fed0000-0000-0000-0000-000000000002','engine-owner','Attached Engine');
select is((select count(*)::int from public.company_engines e join public.companies c on c.id=e.company_id where c.slug='engine-owner'),1,
 'the Company attached the waiting Engine record');
select throws_ok($$insert into public.companies(id,slug,name) values ('1fed0000-0000-0000-0000-000000000003','engine-missing-two','Again')$$,
 '55000','companyEngineMissing','one record makes one Company, so the next needs its own');
select ok(position('company_id' in pg_get_function_result('public.agent_profile_work()'::regprocedure))>0
 and position('company_id' in pg_get_function_result('public.engine_tools_due()'::regprocedure))>0
 and position('company_id' in pg_get_function_result('public.agent_soul_rules_work()'::regprocedure))>0,
 'the worker keepers name the Company each row belongs to');
select ok(exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where c.oid='public.companies'::regclass and t.tgname='attach_company_engine' and not t.tgisinternal),'the Company insert claims a waiting record');
select * from finish();
rollback;
