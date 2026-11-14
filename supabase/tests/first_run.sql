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
select ok((select role='owner' and grant_publishing and grant_money_figures and grant_customer_data and removed_at is null from public.members where person_id='90000000-0000-0000-0000-000000000238'),'the new owner has all company grants');
select is((select count(*)::int from public.work_stages),10,'the company trigger creates the workflow with Done (ADR 0013)');
select is((select count(*)::int from public.approval_steps where role='owner'),1,'the company trigger creates the Owner approval step');
select is((select count(*)::int from public.member_audit where person_id='90000000-0000-0000-0000-000000000238' and action='INSERT'),1,'the membership trigger records the first owner');
select * from finish();
rollback;
