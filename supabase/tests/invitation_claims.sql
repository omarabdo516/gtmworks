begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
-- #775: an invitation never changes someone who is already a Member, and only a person who may invite makes one. RS
-- Learning (seed): عمر the Owner (omar@example.com), مدير the Manager (manager@example.com), مشاهد a Viewer.
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

-- The old path: a Manager writing the invitation row directly, here the Owner's email as a Viewer.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$insert into public.member_invitations(company_id,email,role) values ('10000000-0000-0000-0000-000000000001','omar@example.com','viewer')$$,'42501',null,'a Manager cannot write an invitation row');
select throws_ok($$insert into public.member_invitations(company_id,email,role) values ('10000000-0000-0000-0000-000000000001','new@example.test','viewer')$$,'42501',null,'not even for a new person');
select is((select count(*)::int from public.member_invitations where email in ('omar@example.com','new@example.test')),0,'no invitation was made');
with changed as (update public.member_invitations set role='owner' where company_id='10000000-0000-0000-0000-000000000001' returning 1) select is((select count(*)::int from changed),0,'nor change one');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select isnt(public.invite_member('10000000-0000-0000-0000-000000000001','new@example.test','viewer'),null,'which still invites a new person');

-- However an invitation for a Member's email came to be (an old row, a Member who joined since), claiming it changes
-- nothing about them: the Owner's email invited as a Viewer with no Grants.
reset role;
insert into public.member_invitations(company_id,email,role) values ('10000000-0000-0000-0000-000000000001','omar@example.com','viewer');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.claim_invitations()$$,'the Owner signs in and the invitation is claimed');
select is((select jsonb_build_object('role',role,'publishing',grant_publishing,'money',grant_money_figures,'customer',grant_customer_data) from public.members where company_id='10000000-0000-0000-0000-000000000001' and person_id=auth.uid()),'{"role":"owner","publishing":true,"money":true,"customer":true}'::jsonb,'the Owner is still an Owner with every Grant');
select isnt((select claimed_at from public.member_invitations where company_id='10000000-0000-0000-0000-000000000001' and email='omar@example.com'),null,'and the invitation is closed');
select is((select count(*)::int from public.member_audit where company_id='10000000-0000-0000-0000-000000000001' and person_id=auth.uid() and action='UPDATE' and created_at=now()),0,'no change of the Owner''s row was made');
select * from finish();
rollback;
