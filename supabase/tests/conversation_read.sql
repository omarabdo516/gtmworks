begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
-- A Conversation's row is read by its own person alone (#875, ADR 0033): the row keeps whose it is, its Company and its
-- Agent, and opening it reads the Engine's session only after that row is read. RS Learning's Owner (…01) and Manager
-- (…02); another Company's Member (b875…01) is in R&S Consultations (…02).
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a8750000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f8750000-0000-0000-0000-000000000001','Lead','General',true,'default'),
 ('a8750000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f8750000-0000-0000-0000-000000000002','Faye','Marketing',false,'default');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values
 ('c8750000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a8750000-0000-0000-0000-000000000001','Lead','session-om-875'),
 ('c8750000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a8750000-0000-0000-0000-000000000001','Lead','session-md-875'),
 ('c8750000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a8750000-0000-0000-0000-000000000002','Faye','session-hidden-875');
insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,email_change_token_new,recovery_token) values
 ('00000000-0000-0000-0000-000000000000','b8750000-0000-0000-0000-000000000001','authenticated','authenticated','other-company@example.com',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','');
insert into public.people(id,name) values ('b8750000-0000-0000-0000-000000000001','من شركة تانية');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000002','b8750000-0000-0000-0000-000000000001','manager');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.conversations where id='c8750000-0000-0000-0000-000000000001'),1,'its own person reads the row');
select is((select count(*)::int from public.conversations where id='c8750000-0000-0000-0000-000000000002'),0,'another Member of the same Company does not');
select is((select count(*)::int from public.conversations),1,'the table shows the person their own row alone');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.conversations where id='c8750000-0000-0000-0000-000000000001'),0,'the row stays its own person''s when the other person reads');
select is((select count(*)::int from public.conversations where id='c8750000-0000-0000-0000-000000000003'),0,'a Conversation of an Agent hidden from the reader is not read either');

select set_config('request.jwt.claim.sub','b8750000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.conversations where id='c8750000-0000-0000-0000-000000000001'),0,'a Member of another Company reads nothing');
reset role;
select ok(not has_function_privilege('anon','public.own_conversations(uuid)','execute'),'nobody signed out may read a person''s Conversations');
select * from finish();
rollback;
