begin;
create extension if not exists pgtap with schema extensions;
select plan(50);
-- #17. Lead in RS Learning, on the Company's own profile in the bundled Engine, and each seeded person's Conversation
-- with it: the Owner (1), the Manager (2), the Contributors (3, 5) and the Viewer (4), each asking for an Agent in run rq-n.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('ea000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','co-10000000000000000000000000000001','ciphertext','connected','0.23.0','{run_submission}'),
 ('ea000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','request-test-ads','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('ea000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000001','Lead','General',true),
 ('ea000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000003','Ads','Ads',false);
insert into public.hermes_agent_audit(company_id,actor_id,agent_id,action,details) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000002','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','ea000000-0000-0000-0000-000000000001'));
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','ea000000-0000-0000-0000-000000000004');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('eb000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'ea000000-0000-0000-0000-000000000002','Lead' from generate_series(1,5) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('eb000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','ea000000-0000-0000-0000-000000000004','Ads');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('eb000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone',
  'I want someone to follow up our WhatsApp leads',gen_random_uuid(),'rq-'||n from generate_series(1,5) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','eb000000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000003','Someone','And one for the blog',gen_random_uuid(),'rq-3b'),
 ('10000000-0000-0000-0000-000000000001','eb000000-0000-0000-0000-000000000009','person','20000000-0000-0000-0000-000000000002','Someone','I want someone to follow up our WhatsApp leads',gen_random_uuid(),'rq-9');
select set_config('test.c','10000000-0000-0000-0000-000000000001',true);

-- The worker carries out each run's request_agent call: a Manager's and a Contributor's are kept as their requests.
set local role service_role;
select is(public.lead_request_agent('eb000000-0000-0000-0000-000000000002','rq-2','call-0',' WhatsApp Leads ','Follows up the WhatsApp leads. ','{WhatsApp Business, Canva}')->>'state','requested','the Manager''s call is kept as a request');
select is(public.lead_request_agent('eb000000-0000-0000-0000-000000000003','rq-3','call-0','Blog Writer','Writes the blog.','{WordPress}','writer','You write for {company}.')->>'state','requested','so is the Contributor''s');
select results_eq($$select public.lead_request_agent(('eb000000-0000-0000-0000-00000000000'||n)::uuid,'rq-'||n,'call-0','WhatsApp Leads','Follows up the WhatsApp leads.','{}')->>'state' from unnest(array[1,4]) n order by n$$,
 $$values ('refused'),('refused')$$,'the Owner''s (who makes Agents instead) and the Viewer''s are refused');
select is(public.lead_request_agent('eb000000-0000-0000-0000-000000000002','rq-7','call-0','WhatsApp Leads','Follows up the WhatsApp leads.','{}')->>'state','refused','a run that is not in the Conversation is refused');
select is(public.lead_request_agent('eb000000-0000-0000-0000-000000000009','rq-9','call-0','WhatsApp Leads','Follows up the WhatsApp leads.','{}')->>'state','refused','so is a call in a Conversation with an Agent that is not Lead');
select is(public.lead_request_agent('eb000000-0000-0000-0000-000000000002','rq-2','call-1','WhatsApp Leads','Follows up the WhatsApp leads.','{x,x,x,x,x,x,x,x,x}')->>'state','invalid','a call with nine apps keeps nothing');
reset role;
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local role service_role;
select is(public.lead_request_agent('eb000000-0000-0000-0000-000000000005','rq-5','call-0','WhatsApp Leads','Follows up the WhatsApp leads.','{}')->>'state','refused','a removed Member''s call is refused');
reset role;
update public.members set removed_at=null where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
select set_config('test.m',(select id::text from public.lead_agent_requests where run_id='rq-2'),true);
select set_config('test.k',(select id::text from public.lead_agent_requests where run_id='rq-3'),true);
set local role service_role;
select is(public.lead_request_agent('eb000000-0000-0000-0000-000000000002','rq-2','call-0','Other','Other job','{}'),jsonb_build_object('state','requested','request',current_setting('test.m')::bigint),
 'closing the run again answers the same request');
reset role;
select results_eq($$select asked_by,asked_with,agent_name,job,apps,template,instructions,state,answered_by is null and answered_at is null and reason is null from public.lead_agent_requests order by id$$,
 $$values ('20000000-0000-0000-0000-000000000002'::uuid,'I want someone to follow up our WhatsApp leads','WhatsApp Leads','Follows up the WhatsApp leads.','{WhatsApp Business,Canva}'::text[],null::text,null::text,'waiting',true),
  ('20000000-0000-0000-0000-000000000003'::uuid,'I want someone to follow up our WhatsApp leads','Blog Writer','Writes the blog.','{WordPress}'::text[],'writer','You write for {company}.','waiting',true)$$,
 'two requests, trimmed, each with the message that asked, waiting');
select is((select count(*)::int from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001'),2,'no Agent is made');
select is((select count(*)::int from public.lead_made_agents),0,'nor a record of a made Agent');
select results_eq($$select actor_id,agent_id,details->>'asked_for',details->>'private',details->>'teller' from public.company_log where action='agent_request_sent' order by id$$,
 $$values ('20000000-0000-0000-0000-000000000002'::uuid,'ea000000-0000-0000-0000-000000000002'::uuid,'WhatsApp Leads','owners','20000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003'::uuid,'ea000000-0000-0000-0000-000000000002'::uuid,'Blog Writer','owners','20000000-0000-0000-0000-000000000003')$$,
 'each request is logged once, by the Member who asked, about Lead');

-- Who reads a request, and on whose list it waits: the Owner's only.
create temporary table seen(n int, requests int, waiting int, logged int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*) from public.lead_agent_requests),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_request'),(select count(*) from public.company_log where action='agent_request_sent');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*) from public.lead_agent_requests),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_request'),(select count(*) from public.company_log where action='agent_request_sent');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*) from public.lead_agent_requests),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_request'),(select count(*) from public.company_log where action='agent_request_sent');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*) from public.lead_agent_requests),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_request'),(select count(*) from public.company_log where action='agent_request_sent');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 5,(select count(*) from public.lead_agent_requests),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_request'),(select count(*) from public.company_log where action='agent_request_sent');
reset role;
select results_eq($$select * from seen order by n$$,$$values (1,2,2,2),(2,1,0,1),(3,1,0,1),(4,0,0,0),(5,0,0,0)$$,
 'the Owner reads both and has both waiting; each asker reads only their own and has nothing waiting; the Viewer and another Contributor read none');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select results_eq($$select kind,id,title,body,asked_by,card_id is null and conversation_id is null from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_request' order by id$$,
 $$values ('agent_request',current_setting('test.m')::bigint,'WhatsApp Leads','Follows up the WhatsApp leads.','مدير',true),('agent_request',current_setting('test.k')::bigint,'Blog Writer','Writes the blog.','مراجع',true)$$,
 'each waits on the Owner by its name and job, asked by the Member');

-- No one but an active Owner answers.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.m')::bigint,true)$$,'42501',null,'the Manager cannot make it');
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.k')::bigint,false,'No')$$,'42501',null,'nor say no');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.k')::bigint,true)$$,'42501',null,'nor can the Contributor who asked');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.m')::bigint,true)$$,'42501',null,'nor a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.answer_agent_request('10000000-0000-0000-0000-000000000003',current_setting('test.m')::bigint,true)$$,'P0002',null,'an Owner names the request with its own Company');
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.k')::bigint,null)$$,'22023',null,'and says which way');
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.k')::bigint,false)$$,'22023',null,'«No» needs a reason');
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.k')::bigint,false,E' \n ')$$,'22023',null,'a blank one is none');
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.k')::bigint,false,repeat('x',1001))$$,'22023',null,'nor one over 1000 characters');
reset role;
select is((select count(*)::int from public.lead_agent_requests where state='waiting'),2,'and both still wait');

-- «Make it»: the Agent is made as the Owner's own call makes it, for the Member who asked, who now sees it.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.m')::bigint,true),'made','the Owner makes the Manager''s');
select is(public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.m')::bigint,true),'made','the same answer again answers the same');
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.m')::bigint,false,'Changed my mind')$$,'22023',null,'the other answer is refused');
reset role;
select set_config('test.a',(select id::text from public.hermes_agents where name='WhatsApp Leads'),true);
select ok(exists(select 1 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id
  where a.id=current_setting('test.a')::uuid and a.speciality='Follows up the WhatsApp leads.' and a.apps='{WhatsApp Business,Canva}' and a.requested_by='20000000-0000-0000-0000-000000000002'
   and not a.is_default and a.requester_opened_at is null and h.profile='co-10000000000000000000000000000001' and h.owner_id='20000000-0000-0000-0000-000000000002' and public.is_bundled_connection(h.id)),
 'the Agent has its job, its apps, the Manager as its requester, and its own bundled Connection to the Company''s profile');
select is((select count(*)::int from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001'),3,'one Agent is made');
select results_eq($$select conversation_id,run_id,call_id,agent_id from public.lead_made_agents$$,
 $$values ('eb000000-0000-0000-0000-000000000002'::uuid,'rq-2','call-0',current_setting('test.a')::uuid)$$,'under the call that asked for it');
select results_eq($$select state,answered_by,answered_at is not null,reason from public.lead_agent_requests where id=current_setting('test.m')::bigint$$,
 $$values ('made','20000000-0000-0000-0000-000000000001'::uuid,true,null::text)$$,'the request is made, answered by the Owner');
select is((select count(*)::int from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000002' and agent_id=current_setting('test.a')::uuid),1,'the Manager who asked sees the Agent');
select results_eq($$select actor_id,action,details->>'agent_name',details->>'asked_by' from public.company_log where agent_id=current_setting('test.a')::uuid order by id$$,
 $$values ('20000000-0000-0000-0000-000000000002'::uuid,'agent_requested','WhatsApp Leads',null::text),('20000000-0000-0000-0000-000000000001'::uuid,'agent_request_made','WhatsApp Leads','مدير')$$,
 'the log has the Manager''s request for the Agent and the Owner''s yes, once each');
set local role service_role;
select is(public.lead_create_agent('eb000000-0000-0000-0000-000000000003','rq-3','call-0','Blog Writer','Writes the blog.','{WordPress}')->>'state','refused',
 'a waiting request''s call is not made without «Make it»');
reset role;

-- «No», with the reason that goes to the Contributor.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.k')::bigint,false,E' Ads follows WhatsApp leads now.\n'),'declined','the Owner says no to the Contributor''s');
select is(public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.k')::bigint,false,'Another reason'),'declined','again, the same');
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.k')::bigint,true)$$,'22023',null,'and it cannot be made after');
select is((select count(*)::int from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_request'),0,'both answers took the requests off the Owner''s list');
reset role;
select results_eq($$select state,answered_by,reason from public.lead_agent_requests where id=current_setting('test.k')::bigint$$,
 $$values ('declined','20000000-0000-0000-0000-000000000001'::uuid,'Ads follows WhatsApp leads now.')$$,'the request is declined with its trimmed reason');
select is((select count(*)::int from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001'),3,'and nothing is made');
select results_eq($$select actor_id,agent_id,details->>'asked_for',details->>'asked_by',details->>'reason',details->>'teller' from public.company_log where action='agent_request_declined'$$,
 $$values ('20000000-0000-0000-0000-000000000001'::uuid,'ea000000-0000-0000-0000-000000000002'::uuid,'Blog Writer','مراجع','Ads follows WhatsApp leads now.','20000000-0000-0000-0000-000000000003')$$,
 'the log has the Owner''s no once, about Lead, with the reason');
create temporary table told(n int, sent int, declined int, made int);
grant insert on told to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into told select 2,(select count(*) from public.company_log where action='agent_request_sent'),(select count(*) from public.company_log where action='agent_request_declined'),(select count(*) from public.company_log where action='agent_request_made');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into told select 3,(select count(*) from public.company_log where action='agent_request_sent'),(select count(*) from public.company_log where action='agent_request_declined'),(select count(*) from public.company_log where action='agent_request_made');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into told select 5,(select count(*) from public.company_log where action='agent_request_sent'),(select count(*) from public.company_log where action='agent_request_declined'),(select count(*) from public.company_log where action='agent_request_made');
reset role;
select results_eq($$select * from told order by n$$,$$values (2,1,0,1),(3,1,1,0),(5,0,0,0)$$,
 'the Manager reads their own request and its yes, not the Contributor''s request or its no; the Contributor reads both of theirs; another Contributor reads none');

-- A request that cannot be made now stays waiting; an Owner made later sees it, one made a Manager does not; a Member
-- who left has nothing waiting.
set local role service_role;
select is(public.lead_request_agent('eb000000-0000-0000-0000-000000000003','rq-3b','call-0','Blog Writer','Writes the blog.','{WordPress}')->>'state','requested','the Contributor asks again');
reset role;
select set_config('test.b',(select id::text from public.lead_agent_requests where run_id='rq-3b'),true);
update public.hermes_agents set is_default=false where id='ea000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.b')::bigint,true)$$,'55000',null,'«Make it» once Lead is no longer the main Agent makes nothing');
reset role;
update public.hermes_agents set is_default=true where id='ea000000-0000-0000-0000-000000000002';
select results_eq($$select state,answered_by is null from public.lead_agent_requests where id=current_setting('test.b')::bigint$$,$$values ('waiting',true)$$,'and the request still waits');
select is((select count(*)::int from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001'),3,'with no Agent made');
update public.members set role='owner' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_request'),1,'an Owner made after the request has it waiting');
reset role;
update public.members set role='manager' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select is((select count(*)::int from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_request'),0,'and no longer once made a Manager');
reset role;
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_request'),0,'a request whose Member left waits on no one');
select throws_ok($$select public.answer_agent_request(current_setting('test.c')::uuid,current_setting('test.b')::bigint,false,'Gone')$$,'P0002',null,'and cannot be answered');
reset role;
select * from finish();
rollback;
