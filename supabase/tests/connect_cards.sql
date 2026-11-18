begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
-- #203. Writer in RS Learning, shown to the Manager (2), the Contributors (3, 5) and the Viewer (4); the Owner (1) sees
-- every Agent. One Conversation with Writer each, and in it the message of one run.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('f7100000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f7100000-0000-0000-0000-000000000001','Writer','Articles','connect-test');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'f7100000-0000-0000-0000-000000000002' from generate_series(2,5) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('f9100000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'f7100000-0000-0000-0000-000000000002','Writer' from generate_series(1,5) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('f9100000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone','Write the weekly report',gen_random_uuid(),'connect-run-'||n from generate_series(1,5) n;

-- A run is pinned at its first start with the text of the tools its person is offered: ask_for_app goes after hand_over
-- for an Owner, a Manager and a Contributor, and a Viewer is offered nothing.
select set_config('test.specs','{"create_agent":"{\"name\":\"create_agent\"}","save_rule":"{\"name\":\"save_rule\"}","suggest_rule":"{\"name\":\"suggest_rule\"}","show_draft":"{\"name\":\"show_draft\"}","show_review":"{\"name\":\"show_review\"}","hand_over":"{\"name\":\"hand_over\"}","ask_for_app":"{\"name\":\"ask_for_app\"}"}',true);
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 select ('f9100000-0000-0000-0000-00000000000'||n)::uuid,('fa100000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','f7100000-0000-0000-0000-000000000001',
  ('20000000-0000-0000-0000-00000000000'||n)::uuid,'f7100000-0000-0000-0000-000000000002','Write the weekly report','connect-test' from generate_series(1,4) n;
select public.pinned_run_note(('f9100000-0000-0000-0000-00000000000'||n)::uuid,('fa100000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid) from generate_series(1,4) n;
set local role service_role;
select results_eq($$select public.pin_run(('f9100000-0000-0000-0000-00000000000'||n)::uuid,('fa100000-0000-0000-0000-00000000000'||n)::uuid,current_setting('test.specs')::jsonb)->>'tools' from generate_series(1,4) n order by n$$,
 $$values ('[{"name":"save_rule"},{"name":"show_draft"},{"name":"show_review"},{"name":"hand_over"},{"name":"ask_for_app"}]'),('[{"name":"save_rule"},{"name":"show_draft"},{"name":"show_review"},{"name":"hand_over"},{"name":"ask_for_app"}]'),
  ('[{"name":"suggest_rule"},{"name":"show_draft"},{"name":"show_review"},{"name":"hand_over"},{"name":"ask_for_app"}]'),(null)$$,
 'the Owner''s, the Manager''s and the Contributor''s runs are offered ask_for_app after hand_over, and the Viewer''s nothing');
reset role;

-- The card: the app's key and the Agent's reason, kept open, once per run and call.
select set_config('test.connect','{"app":"amplitude","reason":"مش متوصل، فمقدرتش أعرف مين من الليدز اشترى فعلاً. لو وصّلته هقدر أحسب العائد بدقة."}',true);
set local role service_role;
select results_eq($$select n,public.agent_show_card(('f9100000-0000-0000-0000-00000000000'||n)::uuid,'connect-run-'||n,'call-0','connect','Amplitude',current_setting('test.connect')::jsonb)->>'state' from generate_series(1,4) n order by n$$,
 $$values (1,'shown'),(2,'shown'),(3,'shown'),(4,'refused')$$,'the Owner''s, the Manager''s and the Contributor''s connect cards are shown, and a Viewer''s is refused');
select set_config('test.again',public.agent_show_card('f9100000-0000-0000-0000-000000000001','connect-run-1','call-0','connect','Amplitude',current_setting('test.connect')::jsonb)::text,true);
select is(public.agent_show_card('f9100000-0000-0000-0000-000000000005','connect-run-5','call-1','connect',repeat('t',100),jsonb_build_object('app','a'||repeat('b',63),'reason',repeat('r',200)))->>'state','shown',
 'a connect card at every limit is shown');
select results_eq($$select x.n,public.agent_show_card('f9100000-0000-0000-0000-000000000005','connect-run-5','call-'||(x.n+1),'connect',x.title,x.content::jsonb)->>'state' from (values
  (1,null,'{"app":"canva","reason":"For the designs"}'),
  (2,'Canva','{"app":"canva"}'),
  (3,'Canva','{"reason":"For the designs"}'),
  (4,'Canva',jsonb_build_object('app','canva','reason',repeat('r',201))::text),
  (5,'Canva','{"app":"canva","reason":" "}'),
  (6,'Canva','{"app":"Canva","reason":"For the designs"}'),
  (7,'Canva','{"app":"../canva","reason":"For the designs"}'),
  (8,'Canva','{"app":7,"reason":"For the designs"}'),
  (9,'Canva','{"app":"canva","reason":"For the designs","state":"connected"}'),
  (10,'Canva',jsonb_build_object('app','a'||repeat('b',64),'reason','For the designs')::text)) x(n,title,content) order by x.n$$,
 $$select n,'invalid' from generate_series(1,10) n$$,
 'a connect card with no title, no reason or no app, a reason over 200 characters or blank, an app key out of its shape or too long, or a kept state is not shown');
reset role;
select is(current_setting('test.again')::jsonb,(select jsonb_build_object('state','shown','card',id) from public.reply_cards where conversation_id='f9100000-0000-0000-0000-000000000001'),
 'the same run and call again, as a second closer, answers the card already kept');
select throws_ok($$insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state) values ('10000000-0000-0000-0000-000000000001','f9100000-0000-0000-0000-000000000005','connect-run-5','call-x','connect','Canva','{"app":"canva","reason":"r"}','connected')$$,
 '23514',null,'a connect card is never kept as connected: that is the Engine''s to say');
select results_eq($$select run_id,state,title,content from public.reply_cards where kind='connect' and run_id<>'connect-run-5' order by run_id$$,
 $$select 'connect-run-'||n,'open','Amplitude',current_setting('test.connect')::jsonb from generate_series(1,3) n$$,
 'each connect card shown is kept open, once, with the app and the reason as given');
select is((select count(*) from public.company_log where source='reply_cards' and details->'card'->>'kind'='connect'),0::bigint,'a connect card shown writes no log row');

-- "Later": only the Conversation's own person, while an active Owner; a Manager or a Contributor on their own card, the
-- Owner on another's and a Viewer are refused.
select set_config('test.mine',(select id::text from public.reply_cards where conversation_id='f9100000-0000-0000-0000-000000000001'),true);
select set_config('test.manager',(select id::text from public.reply_cards where conversation_id='f9100000-0000-0000-0000-000000000002'),true);
select set_config('test.log',(select count(*)::text from public.company_log),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.postpone_app_card('10000000-0000-0000-0000-000000000001','f9100000-0000-0000-0000-000000000002',current_setting('test.manager')::bigint)$$,
 '42501','conversationNotAllowed','a Manager cannot postpone their own connect card: apps are the Owner''s');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.postpone_app_card('10000000-0000-0000-0000-000000000001','f9100000-0000-0000-0000-000000000001',current_setting('test.mine')::bigint)$$,
 '42501','conversationNotAllowed','nor a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.postpone_app_card('10000000-0000-0000-0000-000000000001','f9100000-0000-0000-0000-000000000002',current_setting('test.manager')::bigint)$$,
 'P0002','conversationNotFound','the Owner cannot postpone another person''s card');
select throws_ok($$select public.postpone_app_card('10000000-0000-0000-0000-000000000001','f9100000-0000-0000-0000-000000000001',current_setting('test.mine')::bigint-1)$$,
 'P0002','conversationNotFound','a card that is not a connect card of the Conversation is not found');
select is(public.postpone_app_card('10000000-0000-0000-0000-000000000001','f9100000-0000-0000-0000-000000000001',current_setting('test.mine')::bigint),'{"state":"postponed","first":true}'::jsonb,
 'the Owner postpones the card of their own Conversation');
select is(public.postpone_app_card('10000000-0000-0000-0000-000000000001','f9100000-0000-0000-0000-000000000001',current_setting('test.mine')::bigint),'{"state":"postponed","first":false}'::jsonb,
 'a second press, as from a second tab, finds it postponed');
reset role;
select results_eq($$select state,(select count(*)::text from public.company_log) from public.reply_cards where id=current_setting('test.mine')::bigint$$,
 $$values ('postponed',current_setting('test.log'))$$,'the card stays postponed, and Later wrote no log row');

-- Who reads them: each connect card only its Conversation's person, the Owner included.
create temporary table seen(n int, cards int, others int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*) from public.reply_cards where kind='connect'),(select count(*) from public.reply_cards where conversation_id<>'f9100000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*) from public.reply_cards where kind='connect'),(select count(*) from public.reply_cards where conversation_id<>'f9100000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*) from public.reply_cards where kind='connect'),(select count(*) from public.reply_cards where conversation_id<>'f9100000-0000-0000-0000-000000000003');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*) from public.reply_cards where kind='connect'),(select count(*) from public.reply_cards where conversation_id<>'f9100000-0000-0000-0000-000000000004');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 5,(select count(*) from public.reply_cards where kind='connect'),(select count(*) from public.reply_cards where conversation_id<>'f9100000-0000-0000-0000-000000000005');
reset role;
select results_eq($$select * from seen order by n$$,$$values (1,1,0),(2,1,0),(3,1,0),(4,0,0),(5,1,0)$$,
 'each person reads the connect cards of their own Conversation and no other, the Owner included');

select * from finish();
rollback;
