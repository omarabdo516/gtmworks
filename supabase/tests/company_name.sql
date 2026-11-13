begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
-- Only the Owner of a Company renames it (#26); every other Role, and an Owner of another Company, is refused.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.rename_company('10000000-0000-0000-0000-000000000001','  RS Learning Academy  '),'RS Learning Academy','the Owner renames the Company');
select is((select name from public.companies where id='10000000-0000-0000-0000-000000000001'),'RS Learning Academy','the new name is stored, trimmed');
select throws_ok($$select public.rename_company('10000000-0000-0000-0000-000000000001','   ')$$,'22023','companyNameInvalid','an empty name is refused');
select throws_ok($$select public.rename_company('10000000-0000-0000-0000-000000000001',repeat('a',81))$$,'22023','companyNameInvalid','a name over 80 characters is refused');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.rename_company('10000000-0000-0000-0000-000000000001','Manager name')$$,'42501','companyRenameNotAllowed','a Manager cannot rename');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.rename_company('10000000-0000-0000-0000-000000000001','Viewer name')$$,'42501','companyRenameNotAllowed','a Viewer cannot rename');
-- An update of the table itself changes nothing: there is no update policy.
update public.companies set name='Direct' where id='10000000-0000-0000-0000-000000000001';
reset role;
select is((select name from public.companies where id='10000000-0000-0000-0000-000000000001'),'RS Learning Academy','a direct update by a signed-in person changes nothing');
select is((select slug from public.companies where id='10000000-0000-0000-0000-000000000001'),'rs-learning','the address stays');
select * from finish();
rollback;
