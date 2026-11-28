begin;
create extension if not exists pgtap with schema extensions;
select plan(41);
-- #954, ADR 0019: an Administrator or a Manager makes a password link for a Member of their Company; a Manager never for
-- an Administrator. Only its secret's hash is kept, in the table no Member reads; it ends after 24 hours and works once.
-- Sending its form claims it in one transaction that ends every session of the Member. Making and using it are written
-- in the Company log.
-- Seed (supabase/seed.sql): Omar ...01 is the Administrator of every Company; in RS Learning (...0001) ...02 is a
-- Manager, ...03 a Contributor and ...04 a Viewer.
insert into auth.users(id,email) values ('a9540000-0000-0000-0000-000000000010','aleem-admin-954@example.test');
insert into auth.users(id,email) values ('a9540000-0000-0000-0000-000000000011','two-companies-954@example.test'),('a9540000-0000-0000-0000-000000000012','elsewhere-954@example.test'),('a9540000-0000-0000-0000-000000000013','second-admin-954@example.test');
insert into public.people(id,name) values ('a9540000-0000-0000-0000-000000000010','Aleem Admin'),('a9540000-0000-0000-0000-000000000011','Two Companies'),('a9540000-0000-0000-0000-000000000012','Elsewhere'),('a9540000-0000-0000-0000-000000000013','Second Admin');
-- A second Administrator of RS Learning, who is not the install owner.
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000001','a9540000-0000-0000-0000-000000000013','owner');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','a9540000-0000-0000-0000-000000000010','owner');
-- A Contributor of RS Learning who is an Administrator of Aleem, and one who is also a Contributor of a Company the
-- RS Learning Manager is no Member of: one password is both Companies' way in.
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000001','a9540000-0000-0000-0000-000000000011','contributor'),
 ('10000000-0000-0000-0000-000000000003','a9540000-0000-0000-0000-000000000011','owner'),
 ('10000000-0000-0000-0000-000000000001','a9540000-0000-0000-0000-000000000012','contributor'),
 ('10000000-0000-0000-0000-000000000003','a9540000-0000-0000-0000-000000000012','contributor');
-- Two sessions of the Viewer, on two devices.
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('a9540000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-000000000004',now(),now()),
 ('a9540000-0000-0000-0000-0000000000a2','20000000-0000-0000-0000-000000000004',now(),now());

select ok(has_function_privilege('authenticated','public.make_password_link(uuid,uuid,text)','execute') and not has_function_privilege('anon','public.make_password_link(uuid,uuid,text)','execute'),'a signed-in person asks to make a password link');
select ok(not has_function_privilege('authenticated','public.claim_password_link(text)','execute') and not has_function_privilege('anon','public.claim_password_link(text)','execute')
 and has_function_privilege('service_role','public.claim_password_link(text)','execute'),'only the server spends a password link');
select ok(not has_function_privilege('authenticated','public.password_link_open(text)','execute') and has_function_privilege('service_role','public.password_link_open(text)','execute'),'only the server asks whether a password link is open');
select ok(pg_get_functiondef('public.claim_password_link(text)'::regprocedure) ~ 'secret_hash=link_hash[^;]*for update','the claim locks the link before it checks it');
select throws_ok($$insert into public.company_links(company_id,kind,secret_hash,ends_at) values('10000000-0000-0000-0000-000000000001','password',repeat('ab',32),now()+interval '1 day')$$,
 '23514',null,'a password link names the Member it is for');
select throws_ok($$insert into public.company_links(company_id,kind,secret_hash,person_id,role,ends_at) values('10000000-0000-0000-0000-000000000001','password',repeat('ab',32),'20000000-0000-0000-0000-000000000004','viewer',now()+interval '1 day')$$,
 '23514',null,'and gives no Role');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
-- A Contributor and a Viewer make none; another Company's Administrator makes none here.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004',repeat('aa',32))$$,'42501','passwordLinkNotAllowed','a Contributor cannot make a password link');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003',repeat('aa',32))$$,'42501','passwordLinkNotAllowed','nor a Viewer');
select set_config('request.jwt.claim.sub','a9540000-0000-0000-0000-000000000010',true);
select throws_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004',repeat('aa',32))$$,'42501','passwordLinkNotAllowed','nor another Company''s Administrator');
select throws_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004',repeat('aa',32))$$,'P0002','memberNotFound','an Administrator makes none for a Person outside their Company');
-- Omar is the install owner (supabase/seed.sql) and a Member of Aleem: no other Administrator makes his password link.
select throws_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',repeat('aa',32))$$,'42501','passwordLinkInstallOwner','no Administrator makes a password link for the install owner');
-- A Manager makes one for a Viewer and another Manager's equal, never for an Administrator.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000001','a9540000-0000-0000-0000-000000000013',repeat('aa',32))$$,'42501','passwordLinkNotAllowed','the database refuses a Manager''s password link for an Administrator');
select throws_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000001','a9540000-0000-0000-0000-000000000011',repeat('aa',32))$$,'42501','passwordLinkNotAllowed','nor for a Contributor here who is an Administrator of another Company');
select throws_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000001','a9540000-0000-0000-0000-000000000012',repeat('aa',32))$$,'42501','passwordLinkNotAllowed','nor for one who is also in a Company the Manager is not in');
select is((select count(*)::int from public.company_log where action='password_link_made'),0,'a refused link writes nothing to the log');
select throws_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','not-a-hash')$$,'22023','passwordLinkInvalid','only a hash is kept, never anything else');
-- The secret behind this hash is 'c' repeated 64 times; only its sha256 is sent and kept.
select lives_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004',encode(extensions.digest(repeat('c',64),'sha256'),'hex'))$$,'a Manager makes a password link for a Viewer');
select throws_ok($$select count(*) from public.company_links$$,'42501',null,'and reads no link');
-- An Administrator makes one for the Manager, and for an Administrator.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',encode(extensions.digest(repeat('d',64),'sha256'),'hex'))$$,'an Administrator makes one for a Manager');
select lives_ok($$select public.make_password_link('10000000-0000-0000-0000-000000000001','a9540000-0000-0000-0000-000000000011',encode(extensions.digest(repeat('7',64),'sha256'),'hex'))$$,'an Administrator of every Company of the Member makes one');
-- The maker then leaves Aleem, where the Member is an Administrator: the link no longer opens that Company to its holder.
reset role;
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000003' and person_id='20000000-0000-0000-0000-000000000001';
select throws_ok($$select * from public.claim_password_link(encode(extensions.digest(repeat('7',64),'sha256'),'hex'))$$,'55000','passwordLinkEnded','a link whose maker no longer holds every Company of the Member is refused');
set local role authenticated;
reset role;

select is((select ends_at-created_at from public.company_links where secret_hash=encode(extensions.digest(repeat('c',64),'sha256'),'hex')),interval '24 hours','a password link ends after 24 hours');
select is((select count(*)::int from public.company_log where action='password_link_made' and person_id='20000000-0000-0000-0000-000000000004' and actor_id='20000000-0000-0000-0000-000000000002' and details->>'person_name'='مشاهد'),1,'making it is in the Company log, naming the Member');
select is((select company from public.password_link_open(encode(extensions.digest(repeat('c',64),'sha256'),'hex'))),'RS Learning','opening the link names the Company');
select is((select email from public.password_link_open(encode(extensions.digest(repeat('c',64),'sha256'),'hex'))),'viewer@example.com','and the Member''s email');
select is((select used_at from public.company_links where secret_hash=encode(extensions.digest(repeat('c',64),'sha256'),'hex')),null::timestamptz,'and uses nothing');
-- A password link never goes around the second step (Omar, #954): the page learns whether the account has a verified
-- authenticator, and asks for its code.
select is((select two_step from public.password_link_open(encode(extensions.digest(repeat('c',64),'sha256'),'hex'))),false,'an account with no authenticator is asked no code');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
 values ('a9540000-0000-0000-0000-0000000000f1','20000000-0000-0000-0000-000000000004','Authenticator','totp','verified',now(),now(),'JBSWY3DPEHPK3PXP');
select is((select two_step from public.password_link_open(encode(extensions.digest(repeat('c',64),'sha256'),'hex'))),true,'one with a verified authenticator is asked its code');

-- A Manager's link made for a Member who is an Administrator by the time it is sent gives nothing.
insert into public.company_links(company_id,kind,secret_hash,made_by,person_id,ends_at) values
 ('10000000-0000-0000-0000-000000000001','password',encode(extensions.digest(repeat('e',64),'sha256'),'hex'),'20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003',now()+interval '1 day');
update public.members set role='owner' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003';
select throws_ok($$select * from public.claim_password_link(encode(extensions.digest(repeat('e',64),'sha256'),'hex'))$$,'55000','passwordLinkEnded','a Manager''s link never sets an Administrator''s password');
insert into public.company_links(company_id,kind,secret_hash,made_by,person_id,ends_at) values
 ('10000000-0000-0000-0000-000000000003','password',encode(extensions.digest(repeat('6',64),'sha256'),'hex'),'a9540000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000001',now()+interval '1 day');
select throws_ok($$select * from public.claim_password_link(encode(extensions.digest(repeat('6',64),'sha256'),'hex'))$$,'55000','passwordLinkEnded','nor is one, however it was written, ever spent on the install owner''s account');
update public.members set role='contributor' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003';

-- Sending the form spends it, ends every session of the Member, and writes the log.
select is((select slug from public.claim_password_link(encode(extensions.digest(repeat('c',64),'sha256'),'hex'))),'rs-learning','the claim answers the Company''s slug');
select is((select count(*)::int from auth.sessions where user_id='20000000-0000-0000-0000-000000000004'),0,'every session of the Member ends');
select isnt((select used_at from public.company_links where secret_hash=encode(extensions.digest(repeat('c',64),'sha256'),'hex')),null::timestamptz,'the link is marked used');
select is((select count(*)::int from public.company_log where action='password_link_used' and actor_id='20000000-0000-0000-0000-000000000004' and person_id='20000000-0000-0000-0000-000000000004'),1,'using it is in the Company log, by the Member');
select throws_ok($$select * from public.claim_password_link(encode(extensions.digest(repeat('c',64),'sha256'),'hex'))$$,'55000','passwordLinkUsed','a second claim is refused');
select is((select count(*)::int from public.password_link_open(encode(extensions.digest(repeat('c',64),'sha256'),'hex'))),0,'and the used link no longer opens');

-- An ended link is refused; a new link for the same Member ends the earlier one.
update public.company_links set created_at=now()-interval '2 days',ends_at=now()-interval '1 day' where secret_hash=encode(extensions.digest(repeat('d',64),'sha256'),'hex');
select throws_ok($$select * from public.claim_password_link(encode(extensions.digest(repeat('d',64),'sha256'),'hex'))$$,'55000','passwordLinkEnded','an ended link is refused');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.make_password_link('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003',encode(extensions.digest(repeat('f',64),'sha256'),'hex'));
select public.make_password_link('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003',encode(extensions.digest(repeat('9',64),'sha256'),'hex'));
reset role;
select throws_ok($$select * from public.claim_password_link(encode(extensions.digest(repeat('f',64),'sha256'),'hex'))$$,'55000','passwordLinkCancelled','a newer link for the same Member ends the earlier one');
select is((select count(*)::int from public.company_log where action='password_link_cancelled' and person_id='20000000-0000-0000-0000-000000000003'),2,'and each one ended is in the Company log as cancelled: the Manager''s refused link, then the first of these two');
-- An Invite link's page never opens a password link, nor the other way round.
select is((select count(*)::int from public.invite_link_open(encode(extensions.digest(repeat('9',64),'sha256'),'hex'))),0,'a password link is no Invite link');
select is((select count(*)::int from public.password_link_open(encode(extensions.digest(repeat('9',64),'sha256'),'hex'))),1,'and opens as a password link');

select * from finish();
rollback;
