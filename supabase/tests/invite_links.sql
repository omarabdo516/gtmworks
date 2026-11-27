begin;
create extension if not exists pgtap with schema extensions;
select plan(38);
-- #950, ADR 0019: an Administrator makes an Invite link with a label, a Role and the Agents the new Person will see. Only
-- its secret's hash is kept, in a table no Member reads; the link ends after 7 days and never gives the Administrator
-- role. Sending its form claims it once, in one transaction, and the new Member sees the chosen Agents and the main one.
-- Making and using a link are written in the Company log.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a9500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f9500000-0000-0000-0000-000000000001','Lead','General',true,'default'),
 ('a9500000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f9500000-0000-0000-0000-000000000002','Ads','Ads',false,'default'),
 ('a9500000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f9500000-0000-0000-0000-000000000003','SEO','SEO',false,'default'),
 ('a9500000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','f9500000-0000-0000-0000-000000000004','Aleem Ads','Ads',false,'default');
-- An Administrator of Aleem alone, to show one Company's Administrator reaches no other Company's links.
insert into auth.users(id,email) values
 ('a9500000-0000-0000-0000-000000000010','aleem-admin@example.test'),
 ('a9500000-0000-0000-0000-000000000011','nour@example.test'),
 ('a9500000-0000-0000-0000-000000000012','late@example.test');
insert into public.people(id,name) values ('a9500000-0000-0000-0000-000000000010','Aleem Admin');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','a9500000-0000-0000-0000-000000000010','owner');

-- Nobody but the server reads a link, and the secret itself is never a column.
select ok((select relrowsecurity from pg_class where oid='public.company_links'::regclass),'the link table has row-level security on');
select ok(not has_table_privilege('anon','public.company_links','select') and not has_table_privilege('authenticated','public.company_links','select,insert,update,delete'),'no visitor and no Member reads or writes a link');
select ok(not has_table_privilege('authenticated','public.company_link_agents','select,insert,update,delete'),'nor its Agents');
select ok(has_table_privilege('service_role','public.company_links','select'),'only the server role reads it');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns where table_schema='public' and table_name='company_links'),
 array['cancelled_at','company_id','created_at','ends_at','id','kind','label','made_by','role','secret_hash','used_at','used_by'],'the link holds one secret column, its hash');
select ok(has_function_privilege('authenticated','public.make_invite_link(uuid,text,text,uuid[],text)','execute') and not has_function_privilege('anon','public.make_invite_link(uuid,text,text,uuid[],text)','execute'),'a signed-in person asks to make a link');
select ok(not has_function_privilege('authenticated','public.claim_invite_link(text,uuid,text,text)','execute') and not has_function_privilege('anon','public.claim_invite_link(text,uuid,text,text)','execute')
 and has_function_privilege('service_role','public.claim_invite_link(text,uuid,text,text)','execute'),'only the server spends a link');
select ok(not has_function_privilege('authenticated','public.invite_link_open(text)','execute') and has_function_privilege('service_role','public.invite_link_open(text)','execute'),'only the server asks whether a link is open');
-- Two sends at once: the claim locks the link's row before it reads it, so the second waits and then finds it used.
select ok(pg_get_functiondef('public.claim_invite_link(text,uuid,text,text)'::regprocedure) ~ 'secret_hash=link_hash[^;]*for update','the claim locks the link before it checks it');

-- The table itself refuses an Administrator link, whoever writes it.
select throws_ok($$insert into public.company_links(company_id,kind,secret_hash,label,role,ends_at) values('10000000-0000-0000-0000-000000000001','invite',repeat('ab',32),'Boss','owner',now()+interval '7 days')$$,
 '23514',null,'the database refuses an Invite link with the Administrator role');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
-- Only an Administrator of the Company makes one.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.make_invite_link('10000000-0000-0000-0000-000000000001','Nour','contributor','{}',repeat('aa',32))$$,'42501','inviteLinkNotAllowed','a Manager cannot make a link');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.make_invite_link('10000000-0000-0000-0000-000000000001','Nour','contributor','{}',repeat('aa',32))$$,'42501','inviteLinkNotAllowed','nor a Contributor');
select set_config('request.jwt.claim.sub','a9500000-0000-0000-0000-000000000010',true);
select throws_ok($$select public.make_invite_link('10000000-0000-0000-0000-000000000001','Nour','contributor','{}',repeat('aa',32))$$,'42501','inviteLinkNotAllowed','nor another Company''s Administrator');
select throws_ok($$select count(*) from public.company_links$$,'42501',null,'and no Administrator reads the link table');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.make_invite_link('10000000-0000-0000-0000-000000000001','Boss','owner','{}',repeat('aa',32))$$,'22023','inviteRoleNotAllowed','an Administrator link is refused');
select throws_ok($$select public.make_invite_link('10000000-0000-0000-0000-000000000001','   ','viewer','{}',repeat('aa',32))$$,'22023','inviteLinkLabel','a link needs the Person''s name');
select throws_ok($$select public.make_invite_link('10000000-0000-0000-0000-000000000001','Nour','viewer','{}','not-a-hash')$$,'22023','inviteLinkInvalid','only a hash is kept, never anything else');
select throws_ok($$select public.make_invite_link('10000000-0000-0000-0000-000000000001','Nour','viewer',array['a9500000-0000-0000-0000-000000000004']::uuid[],repeat('aa',32))$$,'P0002','agentNotFound','another Company''s Agent is refused');
select throws_ok($$select public.make_invite_link('10000000-0000-0000-0000-000000000001','Nour','viewer',array['a9500000-0000-0000-0000-000000000001']::uuid[],repeat('aa',32))$$,'42501','mainAgentShownToAll','the main Agent is shown to all, so it is not chosen');
select is((select count(*)::int from public.company_log where action='invite_link_made'),0,'a refused link writes nothing to the log');
-- The secret behind this hash is 'b' repeated 64 times; only its sha256 is sent and kept.
select lives_ok($$select public.make_invite_link('10000000-0000-0000-0000-000000000001','  Nour Salah ','contributor',array['a9500000-0000-0000-0000-000000000002']::uuid[],encode(extensions.digest(repeat('b',64),'sha256'),'hex'))$$,
 'the Administrator makes a Contributor link that shows Ads');
select is((select details->>'label' from public.company_log where action='invite_link_made'),'Nour Salah','making it is written in the log with its label');
select is((select actor_id::text||' '||(details->>'role')||' '||(details->>'private') from public.company_log where action='invite_link_made'),'20000000-0000-0000-0000-000000000001 contributor managers','by its maker, with the Role, read by the Administrators and Managers');
reset role;

select ok((select label='Nour Salah' and role='contributor' and made_by='20000000-0000-0000-0000-000000000001' and ends_at between now()+interval '7 days'-interval '1 minute' and now()+interval '7 days'
 and used_at is null and cancelled_at is null from public.company_links),'the link carries its label, Role and maker, and ends after 7 days');
select ok(not exists(select 1 from public.company_links l where l::text like '%'||repeat('b',64)||'%'),'the secret itself is never stored, only its hash');
select is((select array_agg(agent_id) from public.company_link_agents),array['a9500000-0000-0000-0000-000000000002']::uuid[],'the link keeps the Agents chosen for it');

set local role service_role;
-- Opening the page asks whether the link is open, which uses nothing.
select is((select company||' '||role from public.invite_link_open(encode(extensions.digest(repeat('b',64),'sha256'),'hex'))),'RS Learning contributor','an open link names its Company and its Role');
select is((select used_at from public.company_links),null,'asking leaves the link unused');
select is((select count(*)::int from public.invite_link_open(repeat('cd',32))),0,'an unknown link is not open');
select lives_ok($$select public.claim_invite_link(encode(extensions.digest(repeat('b',64),'sha256'),'hex'),'a9500000-0000-0000-0000-000000000011','Nour','ar')$$,'sending the form makes the Person and the Member');
select throws_ok($$select public.claim_invite_link(encode(extensions.digest(repeat('b',64),'sha256'),'hex'),'a9500000-0000-0000-0000-000000000012','Late','en')$$,'55000','inviteLinkUsed','a second send of the same link is refused');
select is((select count(*)::int from public.invite_link_open(encode(extensions.digest(repeat('b',64),'sha256'),'hex'))),0,'a used link is no longer open');
reset role;

select ok((select m.role='contributor' and not m.grant_publishing and m.removed_at is null and p.name='Nour' and p.language='ar' from public.members m join public.people p on p.id=m.person_id
 where m.company_id='10000000-0000-0000-0000-000000000001' and m.person_id='a9500000-0000-0000-0000-000000000011'),'the new Person is a Contributor of the Company, in the chosen language');
select ok(public.agent_visible_to('10000000-0000-0000-0000-000000000001','a9500000-0000-0000-0000-000000000011','a9500000-0000-0000-0000-000000000002')
 and public.agent_visible_to('10000000-0000-0000-0000-000000000001','a9500000-0000-0000-0000-000000000011','a9500000-0000-0000-0000-000000000001')
 and not public.agent_visible_to('10000000-0000-0000-0000-000000000001','a9500000-0000-0000-0000-000000000011','a9500000-0000-0000-0000-000000000003'),'they see the chosen Agent and the main one, and no other');
select ok((select used_by='a9500000-0000-0000-0000-000000000011' and used_at is not null from public.company_links),'the link is kept marked used, by whom');
select is((select actor_id::text||' '||person_id::text||' '||(details->>'label') from public.company_log where action='invite_link_used'),
 'a9500000-0000-0000-0000-000000000011 a9500000-0000-0000-0000-000000000011 Nour Salah','joining is written in the log by the new Member with the link''s label');
select ok(not exists(select 1 from public.people where id='a9500000-0000-0000-0000-000000000012'),'the refused send made no Person');

-- A link past its 7 days is refused even though it was never used.
insert into public.company_links(company_id,kind,secret_hash,made_by,label,role,created_at,ends_at) values
 ('10000000-0000-0000-0000-000000000001','invite',repeat('ef',32),'20000000-0000-0000-0000-000000000001','Old','viewer',now()-interval '8 days',now()-interval '1 day');
set local role service_role;
select throws_ok($$select public.claim_invite_link(repeat('ef',32),'a9500000-0000-0000-0000-000000000012','Late','en')$$,'55000','inviteLinkEnded','a link past its end is refused');
reset role;
select * from finish();
rollback;
