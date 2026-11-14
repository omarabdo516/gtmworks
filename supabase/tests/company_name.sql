begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- Only the Owner of a Company renames it (#26); every other Role, and an Owner of another Company, is refused. Each
-- rename is one row of the Company's log (#11) with who did it and the old and new name; a refused one writes none.
create temporary table before_rename as select (select name from public.companies where id='10000000-0000-0000-0000-000000000001') as name,
 (select count(*) from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and subject='company') as rows;
grant select on before_rename to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.rename_company('10000000-0000-0000-0000-000000000001','  RS Learning Academy  '),'RS Learning Academy','the Owner renames the Company');
select is((select name from public.companies where id='10000000-0000-0000-0000-000000000001'),'RS Learning Academy','the new name is stored, trimmed');
select is((select count(*) from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and subject='company'),(select rows from before_rename)+1,'the rename writes one log row');
select is((select jsonb_build_array(actor_id,actor_kind,action,details->>'old_name',details->>'new_name') from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and subject='company' order by id desc limit 1),
 jsonb_build_array('20000000-0000-0000-0000-000000000001','person','company_renamed',(select name from before_rename),'RS Learning Academy'),'the row names who renamed it, the old name and the new one');
select throws_ok($$select public.rename_company('10000000-0000-0000-0000-000000000001','   ')$$,'22023','companyNameInvalid','an empty name is refused');
select throws_ok($$select public.rename_company('10000000-0000-0000-0000-000000000001',repeat('a',81))$$,'22023','companyNameInvalid','a name over 80 characters is refused');
select is(public.rename_company('10000000-0000-0000-0000-000000000001','RS Learning Academy'),'RS Learning Academy','the same name again changes nothing');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.rename_company('10000000-0000-0000-0000-000000000001','Manager name')$$,'42501','companyRenameNotAllowed','a Manager cannot rename');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.rename_company('10000000-0000-0000-0000-000000000001','Viewer name')$$,'42501','companyRenameNotAllowed','a Viewer cannot rename');
select is((select count(*) from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and subject='company'),(select rows from before_rename)+1,'refused and unchanged renames write no log row');
select throws_ok($$insert into public.company_audit(company_id,actor_id,action,old_name,new_name) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','company_renamed','a','b')$$,'42501',null,'nobody writes the rename record by hand');
-- An update of the table itself changes nothing: there is no update policy.
update public.companies set name='Direct' where id='10000000-0000-0000-0000-000000000001';
reset role;
select is((select name from public.companies where id='10000000-0000-0000-0000-000000000001'),'RS Learning Academy','a direct update by a signed-in person changes nothing');
select is((select slug from public.companies where id='10000000-0000-0000-0000-000000000001'),'rs-learning','the address stays');
select is((select count(*) from public.company_audit where company_id='10000000-0000-0000-0000-000000000001' and new_name in ('Manager name','Viewer name','Direct')),0::bigint,'no refused name is recorded');
select * from finish();
rollback;
