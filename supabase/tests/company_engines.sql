begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
-- #380, #382, #378 (T3): one Engine record per Company, readable by server code alone, and a Company names the record it
-- is made on in `companies.engine_id`. The record names no Company; one record serves one Company.
select ok(to_regclass('public.company_engines') is not null,'the Engine record is a table');
select ok((select relrowsecurity from pg_class where oid='public.company_engines'::regclass),'it has row-level security on');
select ok(not has_table_privilege('anon','public.company_engines','select'),'a signed-out visitor reads nothing');
select ok(not has_table_privilege('authenticated','public.company_engines','select'),'no Member holds a grant on it');
select ok(has_table_privilege('service_role','public.company_engines','select'),'only the server role reads it');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_engines' and column_name='company_id'),
 'the record names no Company: the Company names the record');
select ok(exists(select 1 from pg_constraint where conname='companies_engine_unique' and conrelid='public.companies'::regclass and contype='u'),
 'one record serves one Company');
-- The Owner of a Company cannot read even its own Engine's key, and no query can tell another Company's record exists.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select count(*) from public.company_engines$$,'42501',null,'the Owner, like every Member, reads no Engine record');
reset role;
set local role service_role;
select ok((select count(*) from public.company_engines)>0,'the server role reads the Engine records');
reset role;
-- A Company names the record it is made on; a Company that ends its transaction with no Engine is refused whole. The
-- check is deferred to the commit, so the test sets it immediate to see the refusal now.
delete from public.company_engines e where not exists(select 1 from public.companies c where c.engine_id=e.id);
set constraints company_needs_engine immediate;
select throws_ok($$insert into public.companies(id,slug,name) values ('1fed0000-0000-0000-0000-000000000001','engine-missing','No Engine')$$,
 '55000','companyEngineMissing','a Company with no Engine is refused');
select is((select count(*)::int from public.companies where slug='engine-missing'),0,'the refused Company left nothing behind');
set constraints company_needs_engine deferred;
insert into public.company_engines(id,address,key_encrypted) values ('e3820000-0000-4000-8000-000000000001','http://gtmworks-engine-one:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('1fed0000-0000-0000-0000-000000000002','engine-owner','Attached Engine','e3820000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.companies c join public.company_engines e on e.id=c.engine_id where c.slug='engine-owner'),1,
 'the Company names the Engine record it was made on');
-- The named record serves one Company only, and a name that is no record is refused.
select throws_ok($$insert into public.companies(id,slug,name,engine_id) values ('1fed0000-0000-0000-0000-000000000003','engine-shared','Same Engine','e3820000-0000-4000-8000-000000000001')$$,
 '23505',null,'a record already serving a Company is not taken by another');
select throws_ok($$insert into public.companies(id,slug,name,engine_id) values ('1fed0000-0000-0000-0000-000000000004','engine-unknown','Unknown','e3820000-0000-4000-8000-000000000099')$$,
 '23503',null,'a Company cannot name an Engine record that does not exist: its foreign key refuses it');
select ok(position('company_id' in pg_get_function_result('public.agent_profile_work()'::regprocedure))>0
 and position('company_id' in pg_get_function_result('public.engine_tools_due()'::regprocedure))>0
 and position('company_id' in pg_get_function_result('public.agent_soul_rules_work()'::regprocedure))>0,
 'the worker keepers name the Company each row belongs to');
select ok(exists(select 1 from pg_trigger t where t.tgrelid='public.companies'::regclass
 and t.tgname='company_needs_engine' and t.tgdeferrable and t.tginitdeferred),'the missing-Engine check waits for the commit');
select * from finish();
rollback;
