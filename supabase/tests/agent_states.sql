begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
-- RS Learning with Lead (main, idle), Ads and SEO; Aleem's Lead is another Company's. Ads and SEO each have an open Run
-- in the Owner's Conversation and a Card with an item waiting on the Owner. The Contributor (…03) and the Viewer (…04)
-- are shown Ads and not SEO, and SEO's Card also waits on the Contributor.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state)
 select ('f1840000-0000-0000-0000-00000000000'||n)::uuid,case when n=4 then '10000000-0000-0000-0000-000000000003' else '10000000-0000-0000-0000-000000000001' end::uuid,
  '20000000-0000-0000-0000-000000000001','http://localhost','states-'||n,'ciphertext','connected' from generate_series(1,4) n;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('a1840000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f1840000-0000-0000-0000-000000000001','Lead','General',true),
 ('a1840000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f1840000-0000-0000-0000-000000000002','Ads','Ads',false),
 ('a1840000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f1840000-0000-0000-0000-000000000003','SEO','SEO',false),
 ('a1840000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','f1840000-0000-0000-0000-000000000004','Lead','General',true);
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1840000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a1840000-0000-0000-0000-000000000002');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c1840000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a1840000-0000-0000-0000-000000000002','Ads'),
 ('c1840000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a1840000-0000-0000-0000-000000000003','SEO');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('c1840000-0000-0000-0000-00000000000'||n)::uuid,'person','20000000-0000-0000-0000-000000000001','عمر','Plan the week',gen_random_uuid(),'states-run-'||n
 from generate_series(2,3) n;
insert into public.work_cards(company_id,stage_id,title,agent_id)
 select s.company_id,s.id,a.name||' card',a.id from public.hermes_agents a
 cross join lateral (select company_id,id from public.work_stages where company_id=a.company_id order by position limit 1) s
 where a.id in ('a1840000-0000-0000-0000-000000000002','a1840000-0000-0000-0000-000000000003');
insert into public.waiting_items(company_id,person_id,kind,title,card_id)
 select '10000000-0000-0000-0000-000000000001',p.person,'question','Which audience?',w.id from public.work_cards w
 cross join (values ('20000000-0000-0000-0000-000000000001'::uuid),('20000000-0000-0000-0000-000000000003'::uuid)) p(person)
 where w.title in ('Ads card','SEO card') and (w.title='SEO card' or p.person='20000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select results_eq($$select agent,running,waiting_mine from public.agent_states('10000000-0000-0000-0000-000000000001') order by agent$$,
 $$values ('a1840000-0000-0000-0000-000000000001'::uuid,false,false),('a1840000-0000-0000-0000-000000000002'::uuid,true,true),('a1840000-0000-0000-0000-000000000003'::uuid,true,true)$$,
 'the Owner reads every Agent: Lead idle, Ads and SEO running with an item waiting on the Owner');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select agent,running,waiting_mine from public.agent_states('10000000-0000-0000-0000-000000000001') order by agent$$,
 $$values ('a1840000-0000-0000-0000-000000000001'::uuid,false,false),('a1840000-0000-0000-0000-000000000002'::uuid,true,false)$$,
 'the Contributor reads the Agents shown to them, running, and the Owner''s waiting item is not theirs');
select is_empty($$select 1 from public.agent_states('10000000-0000-0000-0000-000000000001') where agent='a1840000-0000-0000-0000-000000000003'$$,
 'nothing about SEO, hidden from the Contributor, though it runs and a Card of it waits on them');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select results_eq($$select agent,running,waiting_mine from public.agent_states('10000000-0000-0000-0000-000000000001') order by agent$$,
 $$values ('a1840000-0000-0000-0000-000000000001'::uuid,false,false),('a1840000-0000-0000-0000-000000000002'::uuid,true,false)$$,
 'the Viewer reads the Agents shown to them, and nothing waits on a Viewer');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is_empty($$select * from public.agent_states('10000000-0000-0000-0000-000000000003')$$,'a person outside Aleem learns nothing of its Agents');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select results_eq($$select agent,running,waiting_mine from public.agent_states('10000000-0000-0000-0000-000000000003')$$,
 $$values ('a1840000-0000-0000-0000-000000000004'::uuid,false,false)$$,'a member of Aleem reads its Lead');
select set_config('request.jwt.claim.sub','',true);
select is_empty($$select * from public.agent_states('10000000-0000-0000-0000-000000000001')$$,'nor does a caller with no session');

reset role;
insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id) values
 ('10000000-0000-0000-0000-000000000001','c1840000-0000-0000-0000-000000000002','agent','a1840000-0000-0000-0000-000000000002','Ads','Answered','states-run-2');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select agent,running,waiting_mine from public.agent_states('10000000-0000-0000-0000-000000000001') where agent='a1840000-0000-0000-0000-000000000002'$$,
 $$values ('a1840000-0000-0000-0000-000000000002'::uuid,false,false)$$,'an answered Run leaves Ads idle');
select * from finish();
rollback;
