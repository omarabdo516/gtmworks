begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
-- #139. Writer in RS Learning, shown to the Manager (2), the Contributors (3, 5) and the Viewer (4); the Owner (1) sees
-- every Agent. One Conversation with Writer each, and in it the message of one run.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('f7000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f7000000-0000-0000-0000-000000000001','Writer','Articles','hand-test');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'f7000000-0000-0000-0000-000000000002' from generate_series(2,5) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('f9000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'f7000000-0000-0000-0000-000000000002','Writer' from generate_series(1,5) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('f9000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone','Get the article out',gen_random_uuid(),'hand-run-'||n from generate_series(1,5) n;

-- A run is pinned at its first start with the text of the tools its person is offered: hand_over goes after show_review
-- for an Owner, a Manager and a Contributor, and a Viewer is offered nothing.
select set_config('test.specs','{"create_agent":"{\"name\":\"create_agent\"}","save_rule":"{\"name\":\"save_rule\"}","suggest_rule":"{\"name\":\"suggest_rule\"}","show_draft":"{\"name\":\"show_draft\"}","show_review":"{\"name\":\"show_review\"}","hand_over":"{\"name\":\"hand_over\"}"}',true);
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 select ('f9000000-0000-0000-0000-00000000000'||n)::uuid,('fa000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','f7000000-0000-0000-0000-000000000001',
  ('20000000-0000-0000-0000-00000000000'||n)::uuid,'f7000000-0000-0000-0000-000000000002','Get the article out','hand-test' from generate_series(1,4) n;
select public.pinned_run_note(('f9000000-0000-0000-0000-00000000000'||n)::uuid,('fa000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid) from generate_series(1,4) n;
set local role service_role;
select results_eq($$select public.pin_run(('f9000000-0000-0000-0000-00000000000'||n)::uuid,('fa000000-0000-0000-0000-00000000000'||n)::uuid,current_setting('test.specs')::jsonb)->>'tools' from generate_series(1,4) n order by n$$,
 $$values ('[{"name":"save_rule"},{"name":"show_draft"},{"name":"show_review"},{"name":"hand_over"}]'),('[{"name":"save_rule"},{"name":"show_draft"},{"name":"show_review"},{"name":"hand_over"}]'),
  ('[{"name":"suggest_rule"},{"name":"show_draft"},{"name":"show_review"},{"name":"hand_over"}]'),(null)$$,
 'the Owner''s, the Manager''s and the Contributor''s runs are offered hand_over after show_review, and the Viewer''s nothing');
reset role;

-- Nothing else changes when a step is handed over or marked done: no Approval, no Card move, no Version.
create temporary table work_before as select (select count(*) from public.work_activity) activity,(select count(*) from public.work_versions) versions,
 (select string_agg(id||':'||stage_id||':'||coalesce(approval_step_id::text,'-'),',' order by id) from public.work_cards) cards;

select set_config('test.hand','{"app":"WordPress","line":"مقال «إزاي تبدأ في المحاسبة» جاهز كمسودة","rows":[{"label":"الكلمة المفتاحية","value":"كورس محاسبة"},{"label":"الطول","value":"1,450 كلمة"}],"url":"https://rslearning.example/wp-admin/post.php?post=812&action=edit","note":"هتابع ترتيبه في Search Console بعد أسبوع."}',true);
set local role service_role;
select results_eq($$select n,public.agent_show_card(('f9000000-0000-0000-0000-00000000000'||n)::uuid,'hand-run-'||n,'call-0','hand','انشر المقال',current_setting('test.hand')::jsonb)->>'state' from generate_series(1,4) n order by n$$,
 $$values (1,'shown'),(2,'shown'),(3,'shown'),(4,'refused')$$,'the Owner''s, the Manager''s and the Contributor''s hand cards are shown, and a Viewer''s is refused');
select is(public.agent_show_card('f9000000-0000-0000-0000-000000000005','hand-run-5','call-0','hand',repeat('t',100),
  jsonb_build_object('app',repeat('a',40),'line',repeat('l',160),'url','https://example.com/'||repeat('u',1980),'note',repeat('n',240),
   'rows',(select jsonb_agg(jsonb_build_object('label',repeat('k',40),'value',repeat('v',240))) from generate_series(1,8) n)))->>'state','shown',
 'a hand card at every limit is shown');
select is(public.agent_show_card('f9000000-0000-0000-0000-000000000005','hand-run-5','call-1','hand','Pay the invoice','{"app":"Stripe","line":"The invoice is ready","rows":[]}')->>'state','shown',
 'one with no address, no note and no rows is shown');
select is(public.agent_show_card('f9000000-0000-0000-0000-000000000005','hand-run-5','call-20','hand','Publish','{"app":"WordPress","line":"Ready","rows":[],"url":"HTTPS://Example.com/Draft"}')->>'state','shown',
 'an https address with its scheme in capitals is shown, as schemes take any case');
select results_eq($$select x.n,public.agent_show_card('f9000000-0000-0000-0000-000000000005','hand-run-5','call-'||(x.n+1),'hand',x.title,x.content::jsonb)->>'state' from (values
  (1,null,'{"app":"WordPress","line":"Ready","rows":[]}'),
  (2,'Publish','{"app":"WordPress","line":"Ready","rows":[],"url":"http://example.com/draft"}'),
  (3,'Publish','{"app":"WordPress","line":"Ready","rows":[],"url":"https://example.com/my draft"}'),
  (4,'Publish','{"app":"WordPress","line":"Ready","rows":[],"decision":"Done"}'),
  (5,'Publish',jsonb_build_object('app','WordPress','line','Ready','rows',(select jsonb_agg(jsonb_build_object('label','Key','value','Value')) from generate_series(1,9)))::text),
  (6,'Publish','{"app":"WordPress","line":"Ready","rows":[],"url":null}'),
  (7,'Publish','{"line":"Ready","rows":[]}'),
  (8,'Publish','{"app":"WordPress","line":"Ready","rows":[],"note":null}'),
  (9,'Publish',jsonb_build_object('app','WordPress','line','Ready','rows','[]'::jsonb,'url','https://example.com/'||repeat('u',1981))::text),
  (10,'Publish','{"app":"WordPress","line":"Ready","rows":[],"url":"javascript:alert(1)"}'),
  (11,'Publish',jsonb_build_object('app',repeat('a',41),'line','Ready','rows','[]'::jsonb)::text),
  (12,'Publish',jsonb_build_object('app','WordPress','line','Ready','rows','[]'::jsonb,'note',repeat('n',241))::text),
  (13,'Publish','{"app":"WordPress","line":"Ready"}')) x(n,title,content) order by x.n$$,
 $$select n,'invalid' from generate_series(1,13) n$$,
 'a hand card with no title, an address that is not https or holds a space or is too long or null, a key out of its shape, nine rows, no app, a null note, an app or note over its limit, or no rows is not shown');
reset role;
select results_eq($$select run_id,state,title,content->>'app',jsonb_array_length(content->'rows'),content ? 'url',content ? 'note',done_by,done_at from public.reply_cards where kind='hand' order by run_id,call_id$$,
 $$values ('hand-run-1','open','انشر المقال','WordPress',2,true,true,null::uuid,null::timestamptz),('hand-run-2','open','انشر المقال','WordPress',2,true,true,null,null),
  ('hand-run-3','open','انشر المقال','WordPress',2,true,true,null,null),('hand-run-5','open',repeat('t',100),repeat('a',40),8,true,true,null,null),('hand-run-5','open','Pay the invoice','Stripe',0,false,false,null,null),('hand-run-5','open','Publish','WordPress',0,true,false,null,null)$$,
 'each hand card shown is kept open, with its rows, address and note as given, and nobody has marked it done');
select is((select count(*) from public.company_log where source='reply_cards' and details->'card'->>'kind'='hand'),0::bigint,
 'a hand card shown writes no log row: its one row is its person''s Done it (#139)');

-- Only the Conversation's own person marks it done, once; another Member of the Company, the Owner included, and a
-- Viewer are refused.
select set_config('test.card',(select id::text from public.reply_cards where conversation_id='f9000000-0000-0000-0000-000000000003'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.mark_hand_done('10000000-0000-0000-0000-000000000001','f9000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint)$$,
 'P0002','conversationNotFound','the Owner cannot mark another person''s hand card done');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.mark_hand_done('10000000-0000-0000-0000-000000000001','f9000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint)$$,
 'P0002','conversationNotFound','nor can the Manager');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.mark_hand_done('10000000-0000-0000-0000-000000000001','f9000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint)$$,
 'P0002','conversationNotFound','nor another Contributor');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.mark_hand_done('10000000-0000-0000-0000-000000000001','f9000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint)$$,
 '42501','conversationNotAllowed','nor a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.mark_hand_done('10000000-0000-0000-0000-000000000001','f9000000-0000-0000-0000-000000000003',(select min(id) from public.reply_cards where conversation_id='f9000000-0000-0000-0000-000000000003')-1)$$,
 'P0002','conversationNotFound','a card that is not a hand card of the Conversation is not found');
select is((select (r->>'state')||':'||(r->>'first') from public.mark_hand_done('10000000-0000-0000-0000-000000000001','f9000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint) r),'done:true',
 'the Contributor marks their hand card done, and the answer says this press was the first');
reset role;
select set_config('test.done_at',(select done_at::text from public.reply_cards where id=current_setting('test.card')::bigint),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.mark_hand_done('10000000-0000-0000-0000-000000000001','f9000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint),
 jsonb_build_object('state','done','at',current_setting('test.done_at')::timestamptz,'first',false),'a second press, as from a second tab, answers the first record and is not the first');
reset role;
select results_eq($$select state,done_by,done_at from public.reply_cards where kind='hand' and (state='done' or done_at is not null)$$,
 $$values ('done','20000000-0000-0000-0000-000000000003'::uuid,current_setting('test.done_at')::timestamptz)$$,
 'one card is done, with who marked it and its first time unchanged');
select results_eq($$select actor_id,actor_kind,actor_name,subject,agent_id,action,details,source_id,created_at from public.company_log where action='agent_hand_done'$$,
 $$select '20000000-0000-0000-0000-000000000003'::uuid,'person',(select name from public.people where id='20000000-0000-0000-0000-000000000003'),'agent','f7000000-0000-0000-0000-000000000002'::uuid,'agent_hand_done',
  '{"hand":{"title":"انشر المقال"},"private":true,"teller":"20000000-0000-0000-0000-000000000003"}'::jsonb,current_setting('test.card')::bigint,current_setting('test.done_at')::timestamptz$$,
 'the press is logged once, privately, as the person who did it, with the step''s title');
select results_eq($$select (select count(*) from public.work_activity),(select count(*) from public.work_versions),
  (select string_agg(id||':'||stage_id||':'||coalesce(approval_step_id::text,'-'),',' order by id) from public.work_cards)$$,
 $$select activity,versions,cards from work_before$$,
 'handing a step over and marking it done record no Approval or Card activity, move no Card and add no Version');

-- Who reads them: each hand card only its Conversation's person, the Owner included; the done row its person, the Owner
-- and the Manager.
create temporary table seen(n int, cards int, others int, logged int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*) from public.reply_cards where kind='hand'),(select count(*) from public.reply_cards where conversation_id<>'f9000000-0000-0000-0000-000000000001'),(select count(*) from public.company_log where action='agent_hand_done');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*) from public.reply_cards where kind='hand'),(select count(*) from public.reply_cards where conversation_id<>'f9000000-0000-0000-0000-000000000002'),(select count(*) from public.company_log where action='agent_hand_done');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*) from public.reply_cards where kind='hand'),(select count(*) from public.reply_cards where conversation_id<>'f9000000-0000-0000-0000-000000000003'),(select count(*) from public.company_log where action='agent_hand_done');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*) from public.reply_cards where kind='hand'),(select count(*) from public.reply_cards where conversation_id<>'f9000000-0000-0000-0000-000000000004'),(select count(*) from public.company_log where action='agent_hand_done');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 5,(select count(*) from public.reply_cards where kind='hand'),(select count(*) from public.reply_cards where conversation_id<>'f9000000-0000-0000-0000-000000000005'),(select count(*) from public.company_log where action='agent_hand_done');
reset role;
select results_eq($$select * from seen order by n$$,$$values (1,1,0,1),(2,1,0,1),(3,1,0,1),(4,0,0,0),(5,3,0,0)$$,
 'each person reads the hand cards of their own Conversation and no other, the Owner included; the done row is read by its person, the Owner and the Manager, and not by another Contributor or the Viewer');

select * from finish();
rollback;
