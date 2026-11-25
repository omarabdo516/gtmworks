begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
-- Exercise the installed function against the same empty state as the browser, without recreating it as the test caller.
do $$ declare tables text; begin
 select string_agg(format('%I.%I',schemaname,tablename),',') into tables from pg_tables where schemaname='public';
 execute 'truncate '||tables||' restart identity cascade';
end $$;
truncate auth.users cascade;
insert into public.setup_claim(closed) values(false);
-- The installer registers the install's Engine before first run, which attaches the first Company to it (#380).
insert into public.company_engines(address,key_encrypted) values ('http://hermes:8642','cipher');
insert into auth.users(id,email) values('90000000-0000-0000-0000-000000000238','setup@example.test');
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select ok(public.setup_is_open(),'an empty install is open to the service role');
select lives_ok($$select public.complete_setup(person=>'90000000-0000-0000-0000-000000000238',person_name=>'First owner',company_name=>'First Company',language=>'ar')$$,'the service role completes an empty install through the installed function');
select ok(not public.setup_is_open(),'successful setup closes the install');
select throws_ok($$select public.complete_setup('90000000-0000-0000-0000-000000000238','Other owner','Other Company','en')$$,'P0001','Setup closed','a later submission is refused');
reset role;
select is((select count(*)::int from auth.users),1,'the existing Auth user is kept');
select ok((select language='ar' and name='First owner' from public.people where id='90000000-0000-0000-0000-000000000238'),'the Auth user becomes a person in the chosen language');
select ok((select slug ~ '^first-company-[a-f0-9]{8}$' and name='First Company' from public.companies),'the first company has its Home slug');
select ok((select count(*)=1 from public.companies c join public.company_engines e on e.id=c.engine_id where c.name='First Company'),'first run names the Engine record the installer registered');
select ok((select role='owner' and grant_publishing and grant_money_figures and grant_customer_data and removed_at is null from public.members where person_id='90000000-0000-0000-0000-000000000238'),'the new owner has all company grants');
-- A new Company needs no workflow made for it: a Card's status is its column, and any Owner or Manager decides a review (#684).
select ok(to_regclass('public.work_stages') is null and to_regclass('public.approval_steps') is null,'a new company has no stages or approval steps to make');
select is((select count(*)::int from public.member_audit where person_id='90000000-0000-0000-0000-000000000238' and action='INSERT'),1,'the membership trigger records the first owner');
select * from finish();
rollback;
