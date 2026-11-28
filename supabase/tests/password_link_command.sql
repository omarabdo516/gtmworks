begin;
create extension if not exists pgtap with schema extensions;
select plan(26);
-- #955, ADR 0019: a Company's last Administrator gets a password link from the server's `gtmworks company password-link`
-- command, which only the service role asks. It names an active Administrator of that Company, ends any earlier live link
-- for the Person, and is kept as the link's hash with no Person as its maker, `made_by` null. Sending that link's form
-- spends it as any other: once, ending every session of the Member, and it is the one link the install owner's account is
-- ever spent with. Any Team-page link on the install owner's account is still refused.
insert into auth.users(id,email) values
 ('a9550000-0000-0000-0000-000000000010','commander-955@example.test'),
 ('a9550000-0000-0000-0000-000000000011','left-955@example.test');
insert into public.people(id,name) values ('a9550000-0000-0000-0000-000000000010','Commander'),('a9550000-0000-0000-0000-000000000011','Left');
-- A second Administrator of RS Learning, who is not the install owner.
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000001','a9550000-0000-0000-0000-000000000010','owner');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','a9550000-0000-0000-0000-000000000010','owner');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000001','a9550000-0000-0000-0000-000000000011','owner');
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('a9550000-0000-0000-0000-0000000000a1','a9550000-0000-0000-0000-000000000010',now(),now()),
 ('a9550000-0000-0000-0000-0000000000a2','a9550000-0000-0000-0000-000000000010',now(),now()),
 ('a9550000-0000-0000-0000-0000000000a3','20000000-0000-0000-0000-000000000001',now(),now());

select ok(has_function_privilege('service_role','public.make_administrator_password_link(uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','public.make_administrator_password_link(uuid,uuid,text)','execute')
 and not has_function_privilege('anon','public.make_administrator_password_link(uuid,uuid,text)','execute'),'only the server makes an Administrator password link');
-- A Manager, a Contributor and a Viewer of the Company are no Administrator of it.
select throws_ok($$select public.make_administrator_password_link('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',repeat('a',64))$$,'42501','passwordLinkNotAdministrator','a Manager of the Company is refused');
select throws_ok($$select public.make_administrator_password_link('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004',repeat('a',64))$$,'42501','passwordLinkNotAdministrator','a Viewer of the Company is refused');
select throws_ok($$select public.make_administrator_password_link('10000000-0000-0000-0000-0000000000ff','a9550000-0000-0000-0000-000000000010',repeat('a',64))$$,'P0002','companyNotFound','an unknown Company is refused');
select throws_ok($$select public.make_administrator_password_link('10000000-0000-0000-0000-000000000001','a9550000-0000-0000-0000-000000000010','not-a-hash')$$,'22023','passwordLinkInvalid','only a hash is kept, never anything else');
select is((select count(*)::int from public.company_links where kind='password'),0,'a refused link writes nothing');

select lives_ok($$select public.make_administrator_password_link('10000000-0000-0000-0000-000000000001','a9550000-0000-0000-0000-000000000010',repeat('a',64))$$,'the server makes a link for an Administrator of the Company');
select is((select made_by from public.company_links where secret_hash=repeat('a',64)),null::uuid,'the server, not a Person, made the link');
select is((select ends_at-created_at from public.company_links where secret_hash=repeat('a',64)),interval '24 hours','and it ends after 24 hours');
select is((select count(*)::int from public.company_log where action='password_link_made' and company_id='10000000-0000-0000-0000-000000000001' and person_id='a9550000-0000-0000-0000-000000000010' and actor_kind='system' and actor_id is null and actor_name='gtmworks command'),1,'making it is in the Company log as the server');

-- A newer link for the same Person ends the earlier one, whichever Company made it.
select lives_ok($$select public.make_administrator_password_link('10000000-0000-0000-0000-000000000003','a9550000-0000-0000-0000-000000000010',repeat('b',64))$$,'a second link for the same Administrator is made');
select is((select count(*)::int from public.company_links where kind='password' and person_id='a9550000-0000-0000-0000-000000000010' and used_at is null and cancelled_at is null),1,'the newer link is the one live link');
select isnt((select cancelled_at from public.company_links where secret_hash=repeat('a',64)),null::timestamptz,'the earlier one is ended');
select is((select count(*)::int from public.company_log where action='password_link_cancelled' and person_id='a9550000-0000-0000-0000-000000000010' and actor_kind='system'),1,'and the ending is in the Company log as the server');

-- Sending the newer link's form spends it: the Administrator is signed in, every session of theirs ends, and the link is used once.
select is((select slug from public.claim_password_link(repeat('b',64))),'aleem','sending the newer link signs its Administrator in through the Company');
select is((select count(*)::int from auth.sessions where user_id='a9550000-0000-0000-0000-000000000010'),0,'every session of that Administrator ends');
select throws_ok($$select * from public.claim_password_link(repeat('a',64))$$,'55000','passwordLinkCancelled','the ended link gives nothing');
select is((select count(*)::int from public.company_log where action='password_link_used' and person_id='a9550000-0000-0000-0000-000000000010' and actor_kind='person'),1,'using it is in the Company log by its Administrator');

-- The install owner's own account: the Team page may not link it, the server does, and only a server-made link is spent on it.
select lives_ok($$select public.make_administrator_password_link('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',repeat('d',64))$$,'the server makes a link for the install owner');
select is((select slug from public.claim_password_link(repeat('d',64))),'rs-learning','and the install owner is signed in with it');
select is((select count(*)::int from auth.sessions where user_id='20000000-0000-0000-0000-000000000001'),0,'their other sessions end too');
insert into public.company_links(company_id,kind,secret_hash,made_by,person_id,ends_at)
 values ('10000000-0000-0000-0000-000000000001','password',repeat('e',64),'20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',now()+interval '1 day');
select throws_ok($$select * from public.claim_password_link(repeat('e',64))$$,'55000','passwordLinkEnded','a Team-page link is still never spent on the install owner');

-- A server link gives nothing once its Administrator is demoted: the command makes it for an Administrator, and the
-- claim asks that of the Person it names again. A Member who left the Company gives nothing too.
select lives_ok($$select public.make_administrator_password_link('10000000-0000-0000-0000-000000000001','a9550000-0000-0000-0000-000000000011',repeat('f',64))$$,'a link is made for a Member who is still an Administrator');
update public.members set role='viewer' where company_id='10000000-0000-0000-0000-000000000001' and person_id='a9550000-0000-0000-0000-000000000011';
select throws_ok($$select * from public.claim_password_link(repeat('f',64))$$,'55000','passwordLinkEnded','a link whose Administrator was demoted gives nothing');
select lives_ok($$select public.make_administrator_password_link('10000000-0000-0000-0000-000000000001','a9550000-0000-0000-0000-000000000010',repeat('9',64))$$,'another link is made for an Administrator');
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='a9550000-0000-0000-0000-000000000010';
select throws_ok($$select * from public.claim_password_link(repeat('9',64))$$,'55000','passwordLinkEnded','a link whose Member left the Company gives nothing');

select * from finish();
rollback;
