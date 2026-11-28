begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
-- #952, ADR 0019: an Administrator adds a Person who is a Member of another Company they administer from the Team page,
-- with a Role and Agents and no link. The database offers exactly those People for that Company, refuses a Person from a
-- Company the Administrator does not administer, the Administrator Role and an active Member here, and writes the added
-- Member and their Agents in the Company log.
insert into public.company_engines(id,address,key_encrypted) values ('e9520000-0000-4000-8000-000000000004','http://127.0.0.1:8642','seed');
insert into public.companies(id,slug,name,engine_id) values ('19000000-0000-0000-0000-000000000004','elsewhere','Elsewhere','e9520000-0000-4000-8000-000000000004');
insert into auth.users(id,email) values
 ('b9520000-0000-0000-0000-000000000001','aleem-helper@example.test'),
 ('b9520000-0000-0000-0000-000000000002','outsider@example.test'),
 ('b9520000-0000-0000-0000-000000000003','elsewhere-owner@example.test'),
 ('b9520000-0000-0000-0000-000000000005','second-helper@example.test');
insert into public.people(id,name) values
 ('b9520000-0000-0000-0000-000000000001','Aleem Helper'),
 ('b9520000-0000-0000-0000-000000000002','Outsider'),
 ('b9520000-0000-0000-0000-000000000003','Elsewhere Owner'),
 ('b9520000-0000-0000-0000-000000000005','Second Helper');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000003','b9520000-0000-0000-0000-000000000001','contributor'),
 ('10000000-0000-0000-0000-000000000003','b9520000-0000-0000-0000-000000000005','viewer'),
 ('19000000-0000-0000-0000-000000000004','b9520000-0000-0000-0000-000000000003','owner'),
 ('19000000-0000-0000-0000-000000000004','b9520000-0000-0000-0000-000000000002','contributor');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a9520000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f9520000-0000-0000-0000-000000000001','Lead','General',true,'default'),
 ('a9520000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f9520000-0000-0000-0000-000000000002','Ads','Ads',false,'default'),
 ('a9520000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f9520000-0000-0000-0000-000000000003','SEO','SEO',false,'default'),
 ('a9520000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','f9520000-0000-0000-0000-000000000004','Aleem Ads','Ads',false,'default');

select ok(has_function_privilege('authenticated','public.add_company_member(uuid,uuid,text,uuid[])','execute')
 and not has_function_privilege('anon','public.add_company_member(uuid,uuid,text,uuid[])','execute')
 and has_function_privilege('authenticated','public.company_addable_people(uuid)','execute')
 and not has_function_privilege('anon','public.company_addable_people(uuid)','execute'),'a signed-in person adds and reads the list, a visitor does neither');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select array_agg(name order by name) from public.company_addable_people('10000000-0000-0000-0000-000000000001')),
 array['Aleem Helper','Second Helper'],'the Administrator is offered the Members of the other Company they administer, and no one already here or outside them');
select is((select company from public.company_addable_people('10000000-0000-0000-0000-000000000001') where name='Aleem Helper'),'Aleem','each Person comes with their Company');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.company_addable_people('10000000-0000-0000-0000-000000000001')),0,'a Manager is offered none');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.add_company_member('10000000-0000-0000-0000-000000000001','b9520000-0000-0000-0000-000000000001','contributor',array['a9520000-0000-0000-0000-000000000002']::uuid[])$$,
 'the Administrator adds the Member of the other Company with a Role and an Agent');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.add_company_member('10000000-0000-0000-0000-000000000001','b9520000-0000-0000-0000-000000000002','viewer','{}')$$,'42501','memberAddNotAllowed','a Manager cannot add anyone');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.add_company_member('10000000-0000-0000-0000-000000000001','b9520000-0000-0000-0000-000000000002','viewer','{}')$$,'42501','memberAddNotAllowed','nor a Contributor');
select set_config('request.jwt.claim.sub','b9520000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.add_company_member('10000000-0000-0000-0000-000000000001','b9520000-0000-0000-0000-000000000001','viewer','{}')$$,'42501','memberAddNotAllowed','nor another Company''s Administrator');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.add_company_member('10000000-0000-0000-0000-000000000001','b9520000-0000-0000-0000-000000000002','viewer','{}')$$,'42501','memberNotFromAdminCompany','a Person from a Company the Administrator does not administer is refused');
select throws_ok($$select public.add_company_member('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','viewer','{}')$$,'23505','alreadyMember','an active Member of this Company is refused');
select throws_ok($$select public.add_company_member('10000000-0000-0000-0000-000000000001','b9520000-0000-0000-0000-000000000002','owner','{}')$$,'22023','memberRoleNotAllowed','the Administrator Role is refused');
select throws_ok($$select public.add_company_member('10000000-0000-0000-0000-000000000001','b9520000-0000-0000-0000-000000000005','viewer',array['a9520000-0000-0000-0000-000000000001']::uuid[])$$,'42501','mainAgentShownToAll','the main Agent is shown to all, so it is not chosen');
select throws_ok($$select public.add_company_member('10000000-0000-0000-0000-000000000001','b9520000-0000-0000-0000-000000000005','viewer',array['a9520000-0000-0000-0000-000000000004']::uuid[])$$,'P0002','agentNotFound','another Company''s Agent is refused');
-- The Person added above is an active Member now: a second add changes nothing.
select throws_ok($$select public.add_company_member('10000000-0000-0000-0000-000000000001','b9520000-0000-0000-0000-000000000001','viewer','{}')$$,'23505','alreadyMember','an active Member is refused');
select is((select array_agg(name order by name) from public.company_addable_people('10000000-0000-0000-0000-000000000001')),array['Second Helper'],'and is no longer offered');
reset role;

select ok((select m.role='contributor' from public.members m where m.company_id='10000000-0000-0000-0000-000000000001' and m.person_id='b9520000-0000-0000-0000-000000000001'),'the Person is a Member here with the chosen Role');
select is((select array_agg(agent_id) from public.member_agent_access where company_id='10000000-0000-0000-0000-000000000001' and person_id='b9520000-0000-0000-0000-000000000001'),
 array['a9520000-0000-0000-0000-000000000002']::uuid[],'and sees the chosen Agent');
select ok(exists(select 1 from public.members where company_id='10000000-0000-0000-0000-000000000003' and person_id='b9520000-0000-0000-0000-000000000001'),'the Company they came from is untouched');
select is((select action||' '||actor_id::text||' '||person_id::text||' '||(details->>'new_role') from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and person_id='b9520000-0000-0000-0000-000000000001' and action='member_added'),
 'member_added 20000000-0000-0000-0000-000000000001 b9520000-0000-0000-0000-000000000001 contributor','the add is written in the Company log by its Administrator, with the Role');
select * from finish();
rollback;
