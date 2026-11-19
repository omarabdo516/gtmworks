begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
-- #383, ADR 0019: a first-Owner link keeps only its secret's hash, is used up by sending the form, and makes the Company
-- on that link's Engine record with the sender as its Owner. `create_company_with_owner` is the one place both the link
-- claim and `company add --owner` make a Company and its Owner member, in one transaction.
select ok(to_regclass('public.company_owner_links') is not null,'the first-Owner link is a table');
select ok((select relrowsecurity from pg_class where oid='public.company_owner_links'::regclass),'it has row-level security on');
select ok(not has_table_privilege('anon','public.company_owner_links','select'),'a signed-out visitor reads no link');
select ok(not has_table_privilege('authenticated','public.company_owner_links','select'),'no Member reads a link');
select ok(has_table_privilege('service_role','public.company_owner_links','select'),'only the server role reads it');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
 where table_schema='public' and table_name='company_owner_links'),array['claimed_at','company_name','created_at','engine_id','id','secret_hash'],
 'the link holds one secret column, its hash');
select ok(not has_function_privilege('authenticated','public.create_company_with_owner(uuid,text,uuid,text,text,text)','execute'),'no Member makes a Company with an Owner');
select ok(has_function_privilege('service_role','public.create_company_with_owner(uuid,text,uuid,text,text,text)','execute'),'the server role makes a Company with an Owner');
select ok(not has_function_privilege('anon','public.claim_company_owner_link(text,uuid,text,text)','execute'),'a signed-out visitor cannot spend a link');
select ok(has_function_privilege('service_role','public.claim_company_owner_link(text,uuid,text,text)','execute'),'the server role spends a link');
select ok(exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
 where i.indrelid='public.company_owner_links'::regclass and i.indisunique and a.attname='engine_id'),'one link per waiting Engine');
insert into auth.users(id,email) values
 ('90000000-0000-0000-0000-000000000383','link-owner@example.test'),
 ('90000000-0000-0000-0000-000000000384','named-owner@example.test');
insert into public.people(id,name) values ('90000000-0000-0000-0000-000000000384','Named Owner');
insert into public.company_engines(id,address,key_encrypted) values
 ('e3830000-0000-4000-8000-000000000001','http://gtmworks-engine-link:8642','cipher'),
 ('e3830000-0000-4000-8000-000000000002','http://gtmworks-engine-named:8642','cipher'),
 ('e3830000-0000-4000-8000-000000000003','http://gtmworks-engine-broken:8642','cipher');
-- The secret the link was printed with is a 64-character value whose sha256 is the hash kept here. It is nowhere stored.
insert into public.company_owner_links(engine_id,company_name,secret_hash) values
 ('e3830000-0000-4000-8000-000000000001','Held Company','df0790f236013511e91fa4532fb7761f62320a51a3868dabf4a13fe5f53e3263'),
 ('e3830000-0000-4000-8000-000000000003','Broken Company','add5b41fc5a881fc87ef4640581ed5ff7fe5eab39640b3a3e6e8b90f0aa71730');
select ok(not exists(select 1 from public.company_owner_links l where l::text like '%ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff%'),
 'the link secret itself is never stored, only its hash');
select throws_ok($$insert into public.company_owner_links(engine_id,company_name,secret_hash)
 values ('e3830000-0000-4000-8000-000000000001','Another Company',repeat('ab',32))$$,'23505',null,'a second link for one waiting Engine is refused, so a fresh link replaces the earlier');
select is((select count(*)::int from public.companies where name='Held Company'),0,'until its link is used the Company exists nowhere');
set local role service_role;
select lives_ok($$select public.claim_company_owner_link('df0790f236013511e91fa4532fb7761f62320a51a3868dabf4a13fe5f53e3263','90000000-0000-0000-0000-000000000383','Link Owner','en')$$,
 'sending the form makes the Company and its Owner in one transaction');
select throws_ok($$select public.claim_company_owner_link('df0790f236013511e91fa4532fb7761f62320a51a3868dabf4a13fe5f53e3263','90000000-0000-0000-0000-000000000383','Link Owner','en')$$,
 '55000','ownerLinkUsed','a second send of the same link is refused');
select lives_ok($$select public.create_company_with_owner('e3830000-0000-4000-8000-000000000002','Named Company','90000000-0000-0000-0000-000000000384',null,null,'named-company-383')$$,
 'the same maker attaches an existing Person as Owner, with no name to write');
select throws_ok($$select public.claim_company_owner_link('add5b41fc5a881fc87ef4640581ed5ff7fe5eab39640b3a3e6e8b90f0aa71730','90000000-0000-0000-0000-0000000003ff','Ghost Owner','en')$$,
 '23503',null,'a failure while making the Owner rolls the whole claim back');
reset role;
select ok((select count(*)=1 from public.companies c join public.company_engines e on e.id=c.engine_id
 where c.name='Held Company' and e.id='e3830000-0000-4000-8000-000000000001'),'the Company is attached to the Engine record behind its link');
select ok((select p.name='Link Owner' and p.language='en' from public.people p where p.id='90000000-0000-0000-0000-000000000383'),'the sender becomes a Person in the chosen language');
select ok((select role='owner' and grant_publishing and grant_money_figures and grant_customer_data and removed_at is null
 from public.members where company_id=(select id from public.companies where name='Held Company')
 and person_id='90000000-0000-0000-0000-000000000383'),'the sender is the Company Owner with all grants');
select ok((select claimed_at is not null from public.company_owner_links where engine_id='e3830000-0000-4000-8000-000000000001'),'the used link is kept marked used');
select ok((select claimed_at is null from public.company_owner_links where engine_id='e3830000-0000-4000-8000-000000000003')
 and not exists(select 1 from public.companies where name='Broken Company'),'the refused claim left the link open and made no Company');
select ok((select count(*)=1 from public.members m join public.companies c on c.id=m.company_id where c.name='Named Company' and m.role='owner'),
 'the named Person is the only Owner of the Company the maker made');
select * from finish();
rollback;
