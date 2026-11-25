begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
-- #774 (vault decision 0071; GLOSSARY.md Owner and Grant): only an Owner changes or removes an Owner, and a Manager
-- never changes their own Role or Grants, whichever way the database is called. RS Learning (seed): عمر the Owner (…01),
-- مدير the Manager (…02), مراجع a Contributor (…03), مشاهد a Viewer (…04) and عضو a Contributor (…05).
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$update public.members set role='owner' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005'$$,'the Owner makes a co-Owner');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.remove_member('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005')$$,'42501','ownerChangedByOwnerOnly','a Manager cannot remove an Owner');
select throws_ok($$update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005'$$,'42501','ownerChangedByOwnerOnly','nor by writing the row');
select throws_ok($$update public.members set role='viewer' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005'$$,'42501','ownerChangedByOwnerOnly','a Manager cannot demote an Owner');
select throws_ok($$update public.members set grant_publishing=false where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000001'$$,'42501','ownerChangedByOwnerOnly','a Manager cannot change an Owner''s Grants');
select throws_ok($$update public.members set grant_money_figures=true where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000002'$$,'42501','ownGrantsUnchangeable','a Manager cannot raise their own Grants');
select throws_ok($$update public.members set role='viewer' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000002'$$,'42501','ownGrantsUnchangeable','nor change their own Role');
select is((select jsonb_build_object('role',role,'money',grant_money_figures) from public.members where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000002'),'{"role":"manager","money":false}'::jsonb,'the Manager''s own row is as it was');
select is((select count(*)::int from public.members where company_id='10000000-0000-0000-0000-000000000001' and role='owner' and removed_at is null),2,'both Owners are still Owners');

-- Everyone else, as today.
select lives_ok($$update public.members set grant_publishing=false where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003'$$,'a Manager still changes a Contributor');
select lives_ok($$update public.members set role='contributor' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000004'$$,'and a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$update public.members set role='manager' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000004'$$,'the Owner makes a second Manager');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$update public.members set grant_customer_data=true where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000004'$$,'a Manager changes another Manager');
select lives_ok($$select public.remove_member('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004')$$,'and removes another Manager');
select throws_ok($$update public.members set role='owner' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003'$$,'P0001','only an owner can assign owner','the guard that only an Owner makes an Owner stays');

-- An Owner changes and removes another Owner; the last Owner stays.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$update public.members set grant_publishing=false where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005'$$,'an Owner changes another Owner''s Grants');
select lives_ok($$update public.members set grant_publishing=true where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000001'$$,'and their own');
select lives_ok($$select public.remove_member('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005')$$,'an Owner removes another Owner');
select throws_ok($$select public.remove_member('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')$$,'P0001','last owner cannot be removed or demoted','the last Owner is still kept');

select * from finish();
rollback;
