begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
-- #915 (decision 0081): the install owner is one account, the one first-run made with the server's setup code. A person
-- asks only whether they are it; no role of the app reads or writes the record itself.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select ok(public.is_install_owner(),'the seed''s first-run Administrator is the install owner');
select throws_ok($$select person_id from public.install_owner$$,'42501',null,'and cannot read the record itself');
select throws_ok($$update public.install_owner set person_id='20000000-0000-0000-0000-000000000005'$$,'42501',null,'nor move it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select ok(not public.is_install_owner(),'an Administrator of another Company is not the install owner');
select set_config('request.jwt.claim.sub','',true);
select ok(not coalesce(public.is_install_owner(),false),'nobody signed in is not');
reset role;
-- First-run records the account it makes as the install owner.
do $$ declare tables text; begin
 select string_agg(format('%I.%I',schemaname,tablename),',') into tables from pg_tables where schemaname='public';
 execute 'truncate '||tables||' restart identity cascade';
end $$;
truncate auth.users cascade;
insert into public.setup_claim(closed) values(false);
insert into public.company_engines(address,key_encrypted) values ('http://hermes:8642','cipher');
insert into auth.users(id,email) values('90000000-0000-0000-0000-000000000915','setup@example.test');
set local role service_role;
select lives_ok($$select public.complete_setup('90000000-0000-0000-0000-000000000915','First owner','First Company','en')$$,'first-run completes');
reset role;
select is((select person_id from public.install_owner),'90000000-0000-0000-0000-000000000915'::uuid,'first-run records its account as the install owner');
select ok(not has_function_privilege('anon','public.is_install_owner()','execute'),'only a signed-in person asks');
select * from finish();
rollback;
