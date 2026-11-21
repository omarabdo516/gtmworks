begin;
create extension if not exists pgtap with schema extensions;
select plan(56);
-- #167: a Member asks the main Agent for work that belongs to an Agent hidden from them. RS Learning: 1 Owner, 2 Manager,
-- 3 and 5 Contributors, 4 Viewer. Reach (campaigns) is shown to the Manager; Quill (articles) to no one; Aleem has an
-- Agent of its own for reports. Each person talks to Lead in fb…n, run ax-n; the Contributor also talks to Lead in fb…6.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('fa000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000001','Lead','General',true,'co-10000000000000000000000000000001'),
 ('fa000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000003','Reach','Campaigns and ads',false,'access-test-reach'),
 ('fa000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000005','Quill','Articles',false,'access-test-quill'),
 ('fa000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000003','fa000000-0000-0000-0000-000000000007','Ledger','Reports',false,'access-test-ledger');
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','fa000000-0000-0000-0000-000000000004');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('fb000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'fa000000-0000-0000-0000-000000000002','Lead' from generate_series(1,5) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('fb000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','fa000000-0000-0000-0000-000000000002','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('fb000000-0000-0000-0000-00000000000'||n)::uuid,'person',
  ('20000000-0000-0000-0000-00000000000'||case when n=6 then 3 else n end)::uuid,'Someone','Run a Meta campaign for the new course',gen_random_uuid(),'ax-'||n from generate_series(1,6) n;
select set_config('test.c','10000000-0000-0000-0000-000000000001',true);

-- The tool is the main Agent's, offered only while its person has an Agent hidden from them.
select is(public.run_tools(current_setting('test.c')::uuid,'fa000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003') @> array['ask_to_open_agent'],true,
 'a Contributor with hidden Agents is offered the tool with Lead');
select is(public.run_tools(current_setting('test.c')::uuid,'fa000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002') @> array['ask_to_open_agent'],true,
 'so is a Manager from whom Quill is hidden');
select is(public.run_tools(current_setting('test.c')::uuid,'fa000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001') @> array['ask_to_open_agent'],false,
 'an Owner sees every Agent and is not offered it');
select is(public.run_tools(current_setting('test.c')::uuid,'fa000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004') @> array['ask_to_open_agent'],false,
 'nor is a Viewer, who cannot write');
select is(public.run_tools(current_setting('test.c')::uuid,'fa000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002') @> array['ask_to_open_agent'],false,
 'nor any Agent but the main one');
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','fa000000-0000-0000-0000-000000000006');
select is(public.run_tools(current_setting('test.c')::uuid,'fa000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002') @> array['ask_to_open_agent'],false,
 'a Member who sees every Agent is not offered it');
delete from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000002' and agent_id='fa000000-0000-0000-0000-000000000006';

-- The brief names the hidden jobs and who a card for each would name, never the Agents.
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 select ('fb000000-0000-0000-0000-00000000000'||n)::uuid,('fc000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000001',
  ('20000000-0000-0000-0000-00000000000'||n)::uuid,'fa000000-0000-0000-0000-000000000002','Run a Meta campaign','access-test' from generate_series(1,4) n;
insert into public.conversation_run_notes(conversation_id,send_key,company_id)
 select conversation_id,send_key,company_id from public.conversation_run_reservations where conversation_id::text like 'fb000000-%';
set local role service_role;
select is(public.pin_lead_brief('fb000000-0000-0000-0000-000000000003','fc000000-0000-0000-0000-000000000003')->'hidden',
 '[{"job":"Articles","asks":"عمر","role":"owner"},{"job":"Campaigns and ads","asks":"مدير","role":"manager"}]'::jsonb,
 'a Contributor''s brief lists each hidden job with the Manager who sees it, else the Owner');
select is(position('Reach' in public.pin_lead_brief('fb000000-0000-0000-0000-000000000003','fc000000-0000-0000-0000-000000000003')::text)
 +position('Quill' in public.pin_lead_brief('fb000000-0000-0000-0000-000000000003','fc000000-0000-0000-0000-000000000003')::text),0,
 'and never names a hidden Agent');
select is(public.pin_lead_brief('fb000000-0000-0000-0000-000000000002','fc000000-0000-0000-0000-000000000002')->'hidden','[{"job":"Articles","asks":"عمر","role":"owner"}]'::jsonb,
 'a Manager''s names the Owner, never the Manager who asks');
select is(public.pin_lead_brief('fb000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-000000000001')->'hidden','[]'::jsonb,'an Owner''s lists none');
select is(public.pin_lead_brief('fb000000-0000-0000-0000-000000000004','fc000000-0000-0000-0000-000000000004')->'hidden','[]'::jsonb,'nor does a Viewer''s');

-- A call makes the card only for a job an Agent hidden from that person holds.
select is(public.agent_ask_to_open('fb000000-0000-0000-0000-000000000003','ax-3','call-0','Campaigns and ads')->>'state','shown','the Contributor''s call makes a card');
select is(public.agent_ask_to_open('fb000000-0000-0000-0000-000000000006','ax-6','call-0',' campaigns AND ads ')->>'state','shown',
 'the job is read as the team wrote it, in any case, in another Conversation too');
select is(public.agent_ask_to_open('fb000000-0000-0000-0000-000000000003','ax-3','call-1','Articles')->>'state','shown','a card for another hidden Agent');
select is(public.agent_ask_to_open('fb000000-0000-0000-0000-000000000005','ax-5','call-0','Campaigns and ads')->>'state','shown','and one for the other Contributor');
select is(public.agent_ask_to_open('fb000000-0000-0000-0000-000000000002','ax-2','call-0','Campaigns and ads')->>'state','ignored','an Agent the Manager sees makes no card');
select is(public.agent_ask_to_open('fb000000-0000-0000-0000-000000000003','ax-3','call-2','Reports')->>'state','ignored','nor does another Company''s Agent');
select is(public.agent_ask_to_open('fb000000-0000-0000-0000-000000000003','ax-3','call-3',' ')->>'state','invalid','a blank job keeps nothing');
select results_eq($$select public.agent_ask_to_open(('fb000000-0000-0000-0000-00000000000'||n)::uuid,'ax-'||n,'call-0','Articles')->>'state' from unnest(array[1,4]) n order by n$$,
 $$values ('refused'),('refused')$$,'the Owner''s and the Viewer''s calls are refused');
select is(public.agent_ask_to_open('fb000000-0000-0000-0000-000000000003','ax-9','call-0','Articles')->>'state','refused','so is a run that is not in the Conversation');
reset role;
select set_config('test.a',(select id::text from public.agent_access_requests where conversation_id='fb000000-0000-0000-0000-000000000003' and call_id='call-0'),true);
select set_config('test.a2',(select id::text from public.agent_access_requests where conversation_id='fb000000-0000-0000-0000-000000000006'),true);
select set_config('test.q',(select id::text from public.agent_access_requests where call_id='call-1'),true);
select set_config('test.five',(select id::text from public.agent_access_requests where conversation_id='fb000000-0000-0000-0000-000000000005'),true);
set local role service_role;
select is(public.agent_ask_to_open('fb000000-0000-0000-0000-000000000003','ax-3','call-0','Articles'),jsonb_build_object('state','shown','card',current_setting('test.a')::bigint),
 'closing the run again answers the same card');
reset role;
select results_eq($$select agent_id,asked_by,named_to,state,pressed_at is null and answered_by is null from public.agent_access_requests order by id$$,
 $$values ('fa000000-0000-0000-0000-000000000004'::uuid,'20000000-0000-0000-0000-000000000003'::uuid,'20000000-0000-0000-0000-000000000002'::uuid,'offered',true),
  ('fa000000-0000-0000-0000-000000000004'::uuid,'20000000-0000-0000-0000-000000000003'::uuid,'20000000-0000-0000-0000-000000000002'::uuid,'offered',true),
  ('fa000000-0000-0000-0000-000000000006'::uuid,'20000000-0000-0000-0000-000000000003'::uuid,'20000000-0000-0000-0000-000000000001'::uuid,'offered',true),
  ('fa000000-0000-0000-0000-000000000004'::uuid,'20000000-0000-0000-0000-000000000005'::uuid,'20000000-0000-0000-0000-000000000002'::uuid,'offered',true)$$,
 'four cards, each naming the Manager who sees its Agent, or the Owner');

-- Only the Member whose card it is presses it, once.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.press_agent_access(current_setting('test.c')::uuid,'fb000000-0000-0000-0000-000000000003',current_setting('test.a')::bigint,true)-'at',jsonb_build_object('state','asked','first',true),'"Ask" sends the request');
select is(public.press_agent_access(current_setting('test.c')::uuid,'fb000000-0000-0000-0000-000000000003',current_setting('test.a')::bigint,false)-'at',jsonb_build_object('state','asked','first',false),'a second press changes nothing');
select is(public.press_agent_access(current_setting('test.c')::uuid,'fb000000-0000-0000-0000-000000000006',current_setting('test.a2')::bigint,true)->>'state','asked','the same ask from the other Conversation');
select is(public.press_agent_access(current_setting('test.c')::uuid,'fb000000-0000-0000-0000-000000000003',current_setting('test.q')::bigint,true)->>'state','asked','and the ask for Quill');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok(format('select public.press_agent_access(%L,%L,%s,true)',current_setting('test.c'),'fb000000-0000-0000-0000-000000000003',current_setting('test.a')),'P0002',null,'another Contributor cannot press it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok(format('select public.press_agent_access(%L,%L,%s,false)',current_setting('test.c'),'fb000000-0000-0000-0000-000000000003',current_setting('test.a')),'P0002',null,'nor can the Manager it names');
reset role;
update public.members set role='viewer' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok(format('select public.press_agent_access(%L,%L,%s,true)',current_setting('test.c'),'fb000000-0000-0000-0000-000000000005',current_setting('test.five')),'42501',null,'a Member who became a Viewer cannot press their card');
reset role;
update public.members set role='contributor' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.press_agent_access(current_setting('test.c')::uuid,'fb000000-0000-0000-0000-000000000005',current_setting('test.five')::bigint,false)->>'state','dismissed','"No, never mind" sends nothing');

-- Who reads what: the Member's card leaves its Agent out; the list waits on those who may open it.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.agent_access_requests),0,'the Member who asked never reads the rows, which name the Agent');
select results_eq($$select state,named_first,named_role,opened is null and pressed_at is not null from public.conversation_agent_access('fb000000-0000-0000-0000-000000000003') order by id$$,
 $$values ('asked','مدير','manager',true),('asked','عمر','owner',true)$$,'their Conversation reads its two cards, with who each names and no Agent');
select is((select count(*)::int from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_access'),0,'and nothing waits on them');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.conversation_agent_access('fb000000-0000-0000-0000-000000000003')),0,'the Owner reads no card of another person''s Conversation');
select results_eq($$select id,title,body,asked_by from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_access' order by id$$,
 $$values (current_setting('test.a')::bigint,'Reach','Campaigns and ads','مراجع'),(current_setting('test.q')::bigint,'Quill','Articles','مراجع')$$,
 'the Owner has one item per Agent asked for, the asked twice once, and none for the card answered "no"');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select results_eq($$select id,title from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_access'$$,
 $$values (current_setting('test.a')::bigint,'Reach')$$,'the Manager has only the Agent they see');

-- Only an Owner, or a Manager who sees the Agent, answers.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok(format('select public.answer_agent_access(%L,%s,true)',current_setting('test.c'),current_setting('test.a')),'42501',null,'a Contributor cannot answer the item');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok(format('select public.answer_agent_access(%L,%s,true)',current_setting('test.c'),current_setting('test.a')),'42501',null,'nor can the Member who asked');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok(format('select public.answer_agent_access(%L,%s,true)',current_setting('test.c'),current_setting('test.q')),'42501',null,'nor a Manager for an Agent they do not see');
select is(public.answer_agent_access(current_setting('test.c')::uuid,current_setting('test.a')::bigint,true),'opened','the Manager opens Reach for the Member');
select is(public.answer_agent_access(current_setting('test.c')::uuid,current_setting('test.a')::bigint,true),'opened','the same answer again answers the same');
select throws_ok(format('select public.answer_agent_access(%L,%s,false)',current_setting('test.c'),current_setting('test.a')),'22023','agentAccessAnswered','the other answer is refused');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.answer_agent_access(current_setting('test.c')::uuid,current_setting('test.q')::bigint,false),'declined','the Owner says no to Quill');
select throws_ok(format('select public.answer_agent_access(%L,%s,true)',current_setting('test.c'),current_setting('test.five')),'22023','agentAccessAnswered','a card answered "no" is never answered');
select is((select count(*)::int from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_access'),0,'nothing waits on the Owner now');
reset role;
select results_eq($$select id::text,state,answered_by from public.agent_access_requests where state in ('opened','declined') order by id$$,
 $$values (current_setting('test.a'),'opened','20000000-0000-0000-0000-000000000002'::uuid),(current_setting('test.a2'),'opened','20000000-0000-0000-0000-000000000002'::uuid),
  (current_setting('test.q'),'declined','20000000-0000-0000-0000-000000000001'::uuid)$$,'both asks for Reach are opened by the one answer, and Quill is declined');
select results_eq($$select agent_id from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000003'$$,
 $$values ('fa000000-0000-0000-0000-000000000004'::uuid)$$,'the Member now sees Reach, and Quill stays hidden');
select results_eq($$select action,actor_id,agent_id,details->>'asked_by',details->>'private' from public.company_log where action in ('agent_opened_for','agent_kept_hidden') order by id$$,
 $$values ('agent_opened_for','20000000-0000-0000-0000-000000000002'::uuid,'fa000000-0000-0000-0000-000000000004'::uuid,'مراجع',null::text),
  ('agent_kept_hidden','20000000-0000-0000-0000-000000000001'::uuid,'fa000000-0000-0000-0000-000000000006'::uuid,'مراجع','managers')$$,
 'one log row for the opening and one for the no');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select state,opened->>'name' from public.conversation_agent_access('fb000000-0000-0000-0000-000000000003') order by id$$,
 $$values ('opened','Reach'),('declined',null::text)$$,'the Member''s Conversation names Reach once it is opened, and never Quill');

-- Review of #500: a press in another Conversation finds nothing; a card whose Agent the person sees by now sends nothing
-- and says so; a job an Agent they see also does is never offered; an offered card names whoever may open it now.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok(format('select public.press_agent_access(%L,%L,%s,true)',current_setting('test.c'),'fb000000-0000-0000-0000-000000000006',current_setting('test.q')),'P0002',null,
 'a card is pressed only in its own Conversation');
reset role;
set local role service_role;
select is(public.agent_ask_to_open('fb000000-0000-0000-0000-000000000006','ax-6','call-1','Campaigns and ads')->>'state','ignored','an Agent opened for them makes no new card');
reset role;
insert into public.agent_access_requests(company_id,conversation_id,run_id,call_id,agent_id,asked_by,named_to)
 values ('10000000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-000000000006','ax-6','call-9','fa000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.press_agent_access(current_setting('test.c')::uuid,'fb000000-0000-0000-0000-000000000006',(select max(id) from public.conversation_agent_access('fb000000-0000-0000-0000-000000000006')),true),
 jsonb_build_object('state','available','first',false),'a card for an Agent they see by now sends nothing');
select is((select available from public.conversation_agent_access('fb000000-0000-0000-0000-000000000006') order by id desc limit 1),true,'and reads as open for them');
reset role;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('fa000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000009','Pen','articles ',false,'access-test-pen');
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','fa000000-0000-0000-0000-00000000000a');
set local role service_role;
select is(public.agent_ask_to_open('fb000000-0000-0000-0000-000000000005','ax-5','call-1','Articles')->>'state','ignored','a job an Agent they see does is never asked for: that Agent does it');
reset role;
select is((select count(*)::int from public.agents_hidden_from('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005') where speciality='Articles'),0,
 'nor listed in their brief');
update public.members set role='contributor' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select named_first,named_role from public.conversation_agent_access('fb000000-0000-0000-0000-000000000006') where state='offered'$$,
 $$values ('عمر','owner')$$,'an offered card names the Owner once the Manager it named may no longer open the Agent');
reset role;
select * from finish();
rollback;
