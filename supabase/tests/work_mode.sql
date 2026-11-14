begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- #9: a Company stores whether its Owner works alone or with a team. Companies that existed before stay a team; a
-- Company made by first run starts unanswered, and only its Owner answers, once.
select is((select string_agg(distinct coalesce(work_mode,'none'),',') from public.companies),'team','companies made before the question are a team');
-- A Company as first run leaves it: one Owner (the seeded Omar), no answer yet, its main Agent Lead on a Connection.
insert into public.companies(id,slug,name,work_mode) values ('10000000-0000-0000-0000-000000000090','fresh-start','Fresh start',null),('10000000-0000-0000-0000-000000000091','no-lead-yet','No Lead yet',null);
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000090','20000000-0000-0000-0000-000000000001','owner'),('10000000-0000-0000-0000-000000000090','20000000-0000-0000-0000-000000000002','manager'),('10000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000001','owner');
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('f0000000-0000-0000-0000-000000000090','10000000-0000-0000-0000-000000000090','20000000-0000-0000-0000-000000000001','http://localhost','fresh','ciphertext','connected');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('a0000000-0000-0000-0000-000000000090','10000000-0000-0000-0000-000000000090','f0000000-0000-0000-0000-000000000090','Lead','General',true);
select ok(not has_function_privilege('anon','public.choose_work_mode(uuid,text)','execute'),'an anonymous visitor cannot answer');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.choose_work_mode('10000000-0000-0000-0000-000000000090','team')$$,'42501','workModeOwnerOnly','a Manager cannot answer for the Company');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.choose_work_mode('10000000-0000-0000-0000-000000000090','agency')$$,'22023','workModeInvalid','only alone or team is an answer');
select throws_ok($$select public.choose_work_mode('10000000-0000-0000-0000-000000000001','alone')$$,'P0001','workModeChosen','a Company that has its answer is not asked again');
select isnt(public.choose_work_mode('10000000-0000-0000-0000-000000000090','alone'),null,'the Owner answers and gets the Conversation with Lead');
select is((select work_mode from public.companies where id='10000000-0000-0000-0000-000000000090'),'alone','the answer is stored on the Company');
select is((select count(*)::int from public.conversations where company_id='10000000-0000-0000-0000-000000000090'),1,'the workspace holds one Conversation');
select is((select agent_id::text||':'||agent_name||':'||person_id from public.conversations where company_id='10000000-0000-0000-0000-000000000090'),'a0000000-0000-0000-0000-000000000090:Lead:20000000-0000-0000-0000-000000000001','it is the Owner''s own Conversation with Lead');
select throws_ok($$select public.choose_work_mode('10000000-0000-0000-0000-000000000090','team')$$,'P0001','workModeChosen','the answer is given once');
select is(public.choose_work_mode('10000000-0000-0000-0000-000000000091','team'),null,'before Lead arrives the answer is stored with no Conversation');
select is((select work_mode from public.companies where id='10000000-0000-0000-0000-000000000091'),'team','the team answer is stored too');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.conversations where company_id='10000000-0000-0000-0000-000000000090'),0,'another Member does not read the Owner''s Conversation');
reset role;
select throws_ok($$update public.companies set work_mode='both' where id='10000000-0000-0000-0000-000000000091'$$,'23514',null,'the table holds only alone or team');
select * from finish();
rollback;
