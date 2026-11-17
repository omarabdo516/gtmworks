begin;
create extension if not exists pgtap with schema extensions;
select plan(32);
-- #138. Ads in RS Learning, shown to the Manager (2), the Contributors (3, 5) and the Viewer (4); the Owner (1) sees every
-- Agent. One Conversation with Ads each, and in it the message of one run.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('f1000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','questions-test','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('f1000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Ads','Ads');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'f1000000-0000-0000-0000-000000000002' from generate_series(2,5) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('f2000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'f1000000-0000-0000-0000-000000000002','Ads' from generate_series(1,5) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('f2000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone','Plan the December campaign',gen_random_uuid(),'q-run-'||n from generate_series(1,5) n;
select set_config('test.asking','{"id":"p1@1","text":"Which audience first?","choices":["Parents","Students","Teachers"],"multiple":false}',true);

-- The closer keeps the question its read shows, once, in the Conversation of the run that asks it.
set local role service_role;
select results_eq($$select public.track_run_question(('f2000000-0000-0000-0000-00000000000'||n)::uuid,'q-run-'||n,current_setting('test.asking')::jsonb,false,'2026-06-10T10:14:00Z') from generate_series(1,4) n$$,
 $$select '[]'::jsonb from generate_series(1,4)$$,'a question each run asks is kept, with nothing yet to deliver');
select is(public.track_run_question('f2000000-0000-0000-0000-000000000003','q-run-3',current_setting('test.asking')::jsonb,false,'2026-06-10T10:15:00Z'),'[]'::jsonb,'the next read keeps nothing more');
select is(public.track_run_question('f2000000-0000-0000-0000-000000000003','q-run-9',current_setting('test.asking')::jsonb,false,'2026-06-10T10:15:00Z'),'[]'::jsonb,'a run that is not in the Conversation keeps nothing');
select is(public.track_run_question('f2000000-0000-0000-0000-000000000005','q-run-5','{"id":"p9@1","text":"Which?","choices":["A","B","C","D","E"],"multiple":false}',false,'2026-06-10T10:15:00Z'),'[]'::jsonb,
 'a question with more than four choices is not kept as one');
reset role;
select results_eq($$select conversation_id,run_id,call_id,kind,title,state,content from public.reply_cards where kind='question' order by conversation_id$$,
 $$select ('f2000000-0000-0000-0000-00000000000'||n)::uuid,'q-run-'||n,'p1@1','question','Which audience first?','open','{"question":"Which audience first?","choices":["Parents","Students","Teachers"],"multiple":false}'::jsonb from generate_series(1,4) n$$,
 'one open card per run that asked, holding the question and its choices as asked');

-- The open question waits in its own person's "Waiting on you", naming the Agent and opening the Conversation.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select kind,title,asked_by,conversation_id,card_id from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='question'$$,
 $$values ('question','Which audience first?','Ads','f2000000-0000-0000-0000-000000000003'::uuid,null::bigint)$$,'the Contributor reads their question waiting, from Ads, opening their Conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(conversation_id::text,',') from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='question'),'f2000000-0000-0000-0000-000000000001',
 'the Owner reads only the question of their own Conversation');

-- Only the Conversation's own person answers, never a Viewer; one answer, however often or from however many tabs.
reset role;
select set_config('test.card',(select id::text from public.reply_cards where conversation_id='f2000000-0000-0000-0000-000000000003'),true);
select set_config('test.owner_card',(select id::text from public.reply_cards where conversation_id='f2000000-0000-0000-0000-000000000001'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint,1,null,'f3000000-0000-0000-0000-000000000005')$$,
 'P0002','conversationNotFound','another Member cannot answer the question');
select throws_ok($$select public.answer_question('10000000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint,1,null,'f3000000-0000-0000-0000-00000000000b')$$,
 'P0002','conversationNotFound','a Member of another Company, naming that Company, cannot answer this Company''s question');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000004',(select id from public.reply_cards where conversation_id='f2000000-0000-0000-0000-000000000004'),1,null,'f3000000-0000-0000-0000-000000000004')$$,
 '42501','conversationNotAllowed','a Viewer cannot answer, even a question of their own Conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint,1,null,'f3000000-0000-0000-0000-000000000001'),'claimed',
 'the person picks the second choice');
select results_eq($$values
  (public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint,1,null,'f3000000-0000-0000-0000-000000000001')),
  (public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint,0,null,'f3000000-0000-0000-0000-000000000002')),
  (public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000003',null,null,'Parents','f3000000-0000-0000-0000-000000000003'))$$,
 $$values ('claimed'),('taken'),('taken')$$,'the same click again finds its own claim; a click in another tab and a typed answer find it taken');
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='question'),0,'the answered question leaves the person''s list');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',(select id from public.reply_cards where conversation_id='f2000000-0000-0000-0000-000000000001'),3,null,'f3000000-0000-0000-0000-000000000006')$$,
 '22023','questionAnswerInvalid','a pick past the last choice is refused');
select throws_ok($$select public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',null,null,E' \n','f3000000-0000-0000-0000-000000000006')$$,
 '22023','questionAnswerInvalid','typed words that are only spaces are refused');
select is(public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',null,null,'Parents, then students','f3000000-0000-0000-0000-000000000006'),'claimed',
 'typed words answer the open question as written');
reset role;
select results_eq($$select conversation_id,state,content->>'answer',answered_by,answer_key from public.reply_cards where answered_at is not null order by conversation_id$$,
 $$values ('f2000000-0000-0000-0000-000000000001'::uuid,'sending','Parents, then students','20000000-0000-0000-0000-000000000001'::uuid,'f3000000-0000-0000-0000-000000000006'::uuid),
  ('f2000000-0000-0000-0000-000000000003'::uuid,'sending','Students','20000000-0000-0000-0000-000000000003'::uuid,'f3000000-0000-0000-0000-000000000001'::uuid)$$,
 'each claim keeps the Engine''s own text of the pick, or the words as typed, who answered and the claim''s key');

-- The closer delivers each claim; the first verdict counts, and only an answer the Engine took is logged, once.
set local role service_role;
select is(public.track_run_question('f2000000-0000-0000-0000-000000000003','q-run-3',current_setting('test.asking')::jsonb,false,'2026-06-10T10:16:00Z'),
 jsonb_build_array(jsonb_build_object('card',current_setting('test.card')::bigint,'question','p1@1','answer','Students')),'the next read hands over the claim to deliver');
select results_eq($$values (public.settle_question(current_setting('test.card')::bigint,'answered')),(public.settle_question(current_setting('test.card')::bigint,'closed')),
  (public.settle_question(current_setting('test.owner_card')::bigint,'closed'))$$,
 $$values ('answered'),('answered'),('closed')$$,'the Engine took one answer, and a later verdict does not change it; the other came too late and is closed');
select is(public.track_run_question('f2000000-0000-0000-0000-000000000003','q-run-3',null,false,'2026-06-10T10:17:00Z'),'[]'::jsonb,'nothing is left to deliver once it is settled');
reset role;
select results_eq($$select actor_id,actor_kind,actor_name,subject,agent_id,action,details,source_id from public.company_log where source='reply_card_answers'$$,
 $$select '20000000-0000-0000-0000-000000000003'::uuid,'person',(select name from public.people where id='20000000-0000-0000-0000-000000000003'),'agent','f1000000-0000-0000-0000-000000000002'::uuid,'agent_question_answered',
  '{"question":{"text":"Which audience first?","answer":"Students"},"private":true,"teller":"20000000-0000-0000-0000-000000000003"}'::jsonb,current_setting('test.card')::bigint$$,
 'the answer is logged once, privately, as the person who answered, with the question and the answer');

-- The Engine stops waiting (its own time limit, a stop, the run's end): a read that began after the card was kept and no
-- longer shows it closes it, an earlier read does not; a run that ended closes its question.
set local role service_role;
select public.track_run_question('f2000000-0000-0000-0000-000000000005','q-run-5','{"id":"p2@1","text":"Which city?","choices":["Cairo","Giza"],"multiple":false}',false,'2026-06-10T10:20:00Z');
select public.track_run_question('f2000000-0000-0000-0000-000000000005','q-run-5',null,false,'2026-06-10T10:19:00Z');
reset role;
select is((select state from public.reply_cards where conversation_id='f2000000-0000-0000-0000-000000000005'),'open','a read that began before the question was kept does not close it');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='question'),1,'the second Contributor''s question waits');
reset role;
set local role service_role;
select public.track_run_question('f2000000-0000-0000-0000-000000000005','q-run-5',null,false,'2026-06-10T10:21:00Z');
reset role;
set local role authenticated;
select results_eq($$values ((select state from public.reply_cards where call_id='p2@1')),
  (public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000005',(select id from public.reply_cards where call_id='p2@1'),0,null,'f3000000-0000-0000-0000-000000000007')),
  ((select count(*)::text from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='question'))$$,
 $$values ('closed'),('closed'),('0')$$,'a later read that no longer shows it closes it: it can no longer be answered and leaves the list');
reset role;
set local role service_role;
select public.track_run_question('f2000000-0000-0000-0000-000000000005','q-run-5','{"id":"p3@1","text":"Which budget?","choices":[],"multiple":false}',false,'2026-06-10T10:22:00Z');
select public.track_run_question('f2000000-0000-0000-0000-000000000005','q-run-5','{"id":"p3@1","text":"Which budget?","choices":[],"multiple":false}',true,'2026-06-10T10:23:00Z');
select public.track_run_question('f2000000-0000-0000-0000-000000000002','q-run-2','{"id":"p4@1","text":"Which channel?","choices":["Meta","Google"],"multiple":false}',false,'2026-06-10T10:24:00Z');
reset role;
select results_eq($$select call_id,state from public.reply_cards where conversation_id in ('f2000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000005') order by id$$,
 $$values ('p1@1','closed'),('p2@1','closed'),('p3@1','closed'),('p4@1','open')$$,
 'a run that ended closes its question; the read that shows the next question closes the one before and keeps the next');
select throws_ok($$insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state) values
 ('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000002','q-run-2','p5@1','question','Which?','{"question":"Which?","choices":[],"multiple":false}','open')$$,'23505',null,
 'a Conversation waits on one question at a time');

-- A note to a person typed while a question waits stays a note: it is not taken as the answer.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select results_eq($$values (public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000002',null,null,'@مراجع please check the budget','f3000000-0000-0000-0000-00000000000c')),
  ((select state from public.reply_cards where call_id='p4@1'))$$,
 $$values ('none'),('open')$$,'a note to a person typed while a question waits is not its answer, and the question still waits');
reset role;
-- A retried send whose first answer was lost may find a question opened since: a message already queued under its key
-- starts after the Run, so it is not also taken as the answer.
insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message)
 values ('f2000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000002','Meta');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select results_eq($$values (public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000002',null,null,'Meta','f3000000-0000-0000-0000-000000000009'))$$,
 $$values ('none')$$,'typed words already queued under their key are not also the answer');
-- And the other way round: typed words claimed as the answer under their key are not queued or started again when the
-- send that first found no question reaches the queue.
select results_eq($$values (public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000002',null,null,'Google','f3000000-0000-0000-0000-00000000000a')),
  (public.reserve_conversation_turn('f2000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-00000000000a','Google')->>'state'),
  ((select count(*)::text from public.conversation_queued_turns where send_key='f3000000-0000-0000-0000-00000000000a'))$$,
 $$values ('claimed'),('answered'),('0')$$,'typed words already taken as the answer are not queued again');
reset role;

-- Who reads them: each question card only its Conversation's person, the Owner included; the answer's log row its
-- person, the Owner and the Manager.
create temporary table seen(n int, cards int, others int, logged int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*) from public.reply_cards),(select count(*) from public.reply_cards where conversation_id<>'f2000000-0000-0000-0000-000000000001'),(select count(*) from public.company_log where action='agent_question_answered');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*) from public.reply_cards),(select count(*) from public.reply_cards where conversation_id<>'f2000000-0000-0000-0000-000000000002'),(select count(*) from public.company_log where action='agent_question_answered');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*) from public.reply_cards),(select count(*) from public.reply_cards where conversation_id<>'f2000000-0000-0000-0000-000000000003'),(select count(*) from public.company_log where action='agent_question_answered');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*) from public.reply_cards),(select count(*) from public.reply_cards where conversation_id<>'f2000000-0000-0000-0000-000000000004'),(select count(*) from public.company_log where action='agent_question_answered');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 5,(select count(*) from public.reply_cards),(select count(*) from public.reply_cards where conversation_id<>'f2000000-0000-0000-0000-000000000005'),(select count(*) from public.company_log where action='agent_question_answered');
reset role;
select results_eq($$select * from seen order by n$$,$$values (1,1,0,1),(2,2,0,1),(3,1,0,1),(4,1,0,0),(5,2,0,0)$$,
 'each person reads the questions of their own Conversation and no other, the Owner included; the answer''s log row is read by its person, the Owner and the Manager, and not by another Contributor or the Viewer');

-- A slower closer may keep a question for a Run another closer has already ended: that question cannot be answered
-- any more, so a pick on it is refused and the card closes, freeing the Conversation for its next question.
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values ('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Someone','And the budget?',gen_random_uuid(),'q-run-1b');
set local role service_role;
select public.track_run_question('f2000000-0000-0000-0000-000000000001','q-run-1b','{"id":"p6@1","text":"Which budget?","choices":["Low","High"],"multiple":false}',false,'2026-06-10T10:30:00Z');
reset role;
insert into public.conversation_usage(company_id,conversation_id,run_id,outcome) values ('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','q-run-1b','completed');
select set_config('test.ended_card',(select id::text from public.reply_cards where call_id='p6@1'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',current_setting('test.ended_card')::bigint,1,null,'f3000000-0000-0000-0000-00000000000d'),'closed',
 'a question whose Run has already ended cannot be answered');
reset role;
select results_eq($$select state,content ? 'answer' from public.reply_cards where call_id='p6@1'$$,$$values ('closed',false)$$,
 'it closes, holding no answer, so the Conversation can wait on its next question');

select * from finish();
rollback;
