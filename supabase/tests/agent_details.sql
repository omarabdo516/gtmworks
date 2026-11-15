begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
-- RS Learning: Lead (main) and Ads, shown to the Contributor (…03) but not to the Viewer (…04). Omar and the Contributor
-- each asked Ads something it has not answered yet; the Contributor asked last. Aleem (…03 Company) has its own Lead,
-- working for the Member there (…05).
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state)
 select ('f2000000-0000-0000-0000-00000000000'||n)::uuid,case when n=3 then '10000000-0000-0000-0000-000000000003' else '10000000-0000-0000-0000-000000000001' end::uuid,
  '20000000-0000-0000-0000-000000000001','http://localhost','details-'||n,'ciphertext','connected' from generate_series(1,3) n;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('a2000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','Lead','General',true),
 ('a2000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000002','Ads','Ads',false),
 ('a2000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000003','Lead','General',true);
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000002');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c2000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000002','Ads'),
 ('c2000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000002','Ads'),
 ('c2000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000005','a2000000-0000-0000-0000-000000000003','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
 ('10000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','Plan the week',gen_random_uuid(),'details-run-1','2026-06-12T09:00:00Z'),
 ('10000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000003','مراجع','A private question',gen_random_uuid(),'details-run-2','2026-06-12T10:00:00Z'),
 ('10000000-0000-0000-0000-000000000003','c2000000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000005','عضو','Hello',gen_random_uuid(),'details-run-3','2026-06-12T11:00:00Z');
insert into public.work_cards(company_id,stage_id,title,agent_id)
 select company_id,id,'Ads card','a2000000-0000-0000-0000-000000000002' from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' order by position limit 1;
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select results_eq($$select started_at,conversation from public.agent_open_run('10000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000002')$$,
 $$values ('2026-06-12T10:00:00Z'::timestamptz,null::uuid)$$,'the newest open run is another person''s: when it started, and not which Conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select started_at,conversation from public.agent_open_run('10000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000002')$$,
 $$values ('2026-06-12T10:00:00Z'::timestamptz,'c2000000-0000-0000-0000-000000000002'::uuid)$$,'its own person learns which Conversation');
select is((select count(*)::int from public.work_cards where agent_id='a2000000-0000-0000-0000-000000000002'),1,'a Member reads the Agent''s Card');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is_empty($$select * from public.agent_open_run('10000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000002')$$,'an Agent hidden from the Viewer says nothing of its runs');
select is_empty($$select * from public.agent_open_run('10000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001')$$,'the main Agent with no open run is not working');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.agent_open_run('10000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000003')),1,'Aleem''s Lead works for its Member');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is_empty($$select * from public.agent_open_run('10000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000003')$$,'someone outside the Company learns nothing');
select set_config('request.jwt.claim.sub','',true);
select is_empty($$select * from public.agent_open_run('10000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000002')$$,'nor does a caller with no session');

-- The reply closes the Contributor's run: Omar's own run is the newest open one, and it is his.
reset role;
insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id) values
 ('10000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000002','agent','a2000000-0000-0000-0000-000000000002','Ads','Answered','details-run-2');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select results_eq($$select started_at,conversation from public.agent_open_run('10000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000002')$$,
 $$values ('2026-06-12T09:00:00Z'::timestamptz,'c2000000-0000-0000-0000-000000000001'::uuid)$$,'an answered run is no longer open');

reset role;
select throws_ok($$insert into public.work_cards(company_id,stage_id,title,agent_id) select company_id,id,'Elsewhere','a2000000-0000-0000-0000-000000000003' from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' order by position limit 1$$,
 '23503',null,'a Card cannot take another Company''s Agent');
delete from public.hermes_agents where id='a2000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.work_cards where title='Ads card' and agent_id is null and company_id='10000000-0000-0000-0000-000000000001'),1,'removing the Agent keeps its Card, with no Agent');
select is((select count(*)::int from public.work_cards where title='Ads card'),1,'and only that Card');
select * from finish();
rollback;
