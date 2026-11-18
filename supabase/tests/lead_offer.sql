begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
-- #143. The main Agent (Lead) and one more Agent of RS Learning, and what Lead is told per Role: its person's role, the
-- Owner's first name and the Agents that person sees, pinned once for the Run. Then the question waits in each Role's
-- own list and only that person answers it.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile,is_default)
 values('f1430000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',gen_random_uuid(),'Reach','Plans the Meta ads.','reach-offer-test',false);
select set_config('test.main',(select id::text from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001' and is_default),true);
-- A reservation and its note per Role, and a Conversation and a question for each writer.
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 values('e1430000-0000-0000-0000-000000000001','d1430000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f1430000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-000000000001',current_setting('test.main')::uuid,'Make the ads agent','lead-offer-test'),
       ('e1430000-0000-0000-0000-000000000002','d1430000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f1430000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-000000000002',current_setting('test.main')::uuid,'Make the ads agent','lead-offer-test'),
       ('e1430000-0000-0000-0000-000000000003','d1430000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f1430000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-000000000005',current_setting('test.main')::uuid,'Make the ads agent','lead-offer-test'),
       ('e1430000-0000-0000-0000-000000000004','d1430000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','f1430000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-000000000004',current_setting('test.main')::uuid,'Make the ads agent','lead-offer-test'),
       ('e1430000-0000-0000-0000-000000000005','d1430000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','f1430000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-000000000001','f1430000-0000-0000-0000-000000000002','Write the ads','reach-offer-test'),
       ('e1430000-0000-0000-0000-000000000006','d1430000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','f1430000-0000-0000-0000-0000000000c1','20000000-0000-0000-0000-000000000001',current_setting('test.main')::uuid,'Make the ads agent','lead-offer-test');
insert into public.conversation_run_notes(conversation_id,send_key,company_id)
 select conversation_id,send_key,company_id from public.conversation_run_reservations where conversation_id::text like 'e1430000-%';
update public.conversation_run_reservations set start_attempts=1 where conversation_id='e1430000-0000-0000-0000-000000000006';
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','f1430000-0000-0000-0000-000000000002');

-- The brief, per Role: the Owner sees Reach and the Owner's first name is عمر; a Manager who sees no other Agent gets
-- none; the Contributor who sees Reach gets it; the Viewer is offered nothing (lib/lead-offer.mjs writes no offer).
set local role service_role;
select is(public.pin_lead_brief('e1430000-0000-0000-0000-000000000001','d1430000-0000-0000-0000-000000000001')->'role','"owner"'::jsonb,'an Owner''s brief carries their role');
select is(public.pin_lead_brief('e1430000-0000-0000-0000-000000000001','d1430000-0000-0000-0000-000000000001')->'owner','"عمر"'::jsonb,'and the Owner''s first name');
select is(public.pin_lead_brief('e1430000-0000-0000-0000-000000000001','d1430000-0000-0000-0000-000000000001')->'agents' @> '[{"name":"Reach","job":"Plans the Meta ads."}]'::jsonb,true,
 'an Owner sees every Agent, the new one among them');
select is(public.pin_lead_brief('e1430000-0000-0000-0000-000000000002','d1430000-0000-0000-0000-000000000002')->'agents' @> '[{"name":"Reach"}]'::jsonb,false,
 'a Manager who sees no other Agent is given no one to offer');
select is(public.pin_lead_brief('e1430000-0000-0000-0000-000000000003','d1430000-0000-0000-0000-000000000003')->'agents' @> '[{"name":"Reach","job":"Plans the Meta ads."}]'::jsonb,true,
 'a Contributor''s brief names the Agent that person sees');
select is(public.pin_lead_brief('e1430000-0000-0000-0000-000000000004','d1430000-0000-0000-0000-000000000004')->'role','"viewer"'::jsonb,
 'a Viewer''s brief carries the role the words are written for');
select is(public.pin_lead_brief('e1430000-0000-0000-0000-000000000005','d1430000-0000-0000-0000-000000000005'),null::jsonb,
 'any other Agent''s Run is given no brief, and pins none');
reset role;
select is((select lead_brief from public.conversation_run_notes where conversation_id='e1430000-0000-0000-0000-000000000005'),null::jsonb,
 'the other Agent''s note holds no brief');
set local role service_role;
select is(public.pin_lead_brief('e1430000-0000-0000-0000-000000000006','d1430000-0000-0000-0000-000000000006'),null::jsonb,
 'a Run already attempted pins no brief: the previous app version''s request is sent again');
reset role;
-- The first brief stays whatever the person sees later: the Manager gains Reach, and the Run still names none.
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','f1430000-0000-0000-0000-000000000002');
set local role service_role;
select is(public.pin_lead_brief('e1430000-0000-0000-0000-000000000002','d1430000-0000-0000-0000-000000000002')->'agents' @> '[{"name":"Reach"}]'::jsonb,false,
 'the brief pinned at the first start is the one a retry sends');
reset role;

-- Each Role's own question waits in their list, and only they answer it.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e1430001-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',current_setting('test.main')::uuid,'Lead'),
 ('e1430001-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',current_setting('test.main')::uuid,'Lead'),
 ('e1430001-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005',current_setting('test.main')::uuid,'Lead'),
 ('e1430001-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004',current_setting('test.main')::uuid,'Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',id,'person',person_id,'Someone','We need an agent for the ads',gen_random_uuid(),'lo-run-'||right(id::text,1)
 from public.conversations where id::text like 'e1430001-%';
insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state)
 select '10000000-0000-0000-0000-000000000001',id,'lo-run-'||right(id::text,1),'q1','question','Make it?',
  '{"question":"Make it?","choices":["Make it","Not now"],"multiple":false}'::jsonb,'open'
 from public.conversations where id::text like 'e1430001-%';

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='question'),1,'the Owner reads their question waiting');
select is(public.answer_question('10000000-0000-0000-0000-000000000001','e1430001-0000-0000-0000-000000000001',
 (select id from public.reply_cards where conversation_id='e1430001-0000-0000-0000-000000000001'),0,null,gen_random_uuid()),'claimed','the Owner answers it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='question'),1,'the Manager reads their question waiting');
select is(public.answer_question('10000000-0000-0000-0000-000000000001','e1430001-0000-0000-0000-000000000002',
 (select id from public.reply_cards where conversation_id='e1430001-0000-0000-0000-000000000002'),1,null,gen_random_uuid()),'claimed','the Manager answers it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='question'),1,'the Contributor reads their question waiting');
select is(public.answer_question('10000000-0000-0000-0000-000000000001','e1430001-0000-0000-0000-000000000003',
 (select id from public.reply_cards where conversation_id='e1430001-0000-0000-0000-000000000003'),0,null,gen_random_uuid()),'claimed','the Contributor answers it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='question'),1,'the Viewer reads their question waiting');
select throws_ok($$select public.answer_question('10000000-0000-0000-0000-000000000001','e1430001-0000-0000-0000-000000000004',
 (select id from public.reply_cards where conversation_id='e1430001-0000-0000-0000-000000000004'),0,null,gen_random_uuid())$$,
 '42501','conversationNotAllowed','a Viewer answers no question: their chat starts no Run');
select * from finish();
rollback;
