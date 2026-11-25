begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
-- #137. Critic in RS Learning, shown to the Manager (2), the Contributors (3, 5) and the Viewer (4); the Owner (1) sees
-- every Agent. One Conversation with Critic each, and in it the message of one run.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('f4000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','Critic','Reviews','review-test');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'f4000000-0000-0000-0000-000000000002' from generate_series(2,5) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('f5000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'f4000000-0000-0000-0000-000000000002','Critic' from generate_series(1,5) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('f5000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone','Review the December ad texts',gen_random_uuid(),'review-run-'||n from generate_series(1,5) n;

-- A run is pinned at its first start with the text of the tools its person is offered: show_review goes after show_draft
-- for an Owner, a Manager and a Contributor, and a Viewer is offered nothing.
select set_config('test.specs','{"create_agent":"{\"name\":\"create_agent\"}","save_rule":"{\"name\":\"save_rule\"}","suggest_team_rule":"{\"name\":\"suggest_team_rule\"}","show_draft":"{\"name\":\"show_draft\"}","show_review":"{\"name\":\"show_review\"}"}',true);
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 select ('f5000000-0000-0000-0000-00000000000'||n)::uuid,('f6000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',
  ('20000000-0000-0000-0000-00000000000'||n)::uuid,'f4000000-0000-0000-0000-000000000002','Review the December ad texts','review-test' from generate_series(1,4) n;
select public.pinned_run_note(('f5000000-0000-0000-0000-00000000000'||n)::uuid,('f6000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid) from generate_series(1,4) n;
set local role service_role;
select results_eq($$select public.pin_run(('f5000000-0000-0000-0000-00000000000'||n)::uuid,('f6000000-0000-0000-0000-00000000000'||n)::uuid,current_setting('test.specs')::jsonb)->>'tools' from generate_series(1,4) n order by n$$,
 $$values ('[{"name":"save_rule"},{"name":"show_draft"},{"name":"show_review"}]'),('[{"name":"save_rule"},{"name":"show_draft"},{"name":"show_review"}]'),('[{"name":"suggest_team_rule"},{"name":"show_draft"},{"name":"show_review"}]'),(null)$$,
 'the Owner''s, the Manager''s and the Contributor''s runs are offered show_review after show_draft, and the Viewer''s nothing');
reset role;

-- Nothing else changes when a review is shown: no Approval, no Card move, no Version.
create temporary table work_before as select (select count(*) from public.work_activity) activity,(select count(*) from public.work_versions) versions,
 (select string_agg(id||':'||status,',' order by id) from public.work_cards) cards;

select set_config('test.review','{"line":"3 نصوص · Meta Ads · قبل ما تطلع","items":[{"text":"من خريج تجارة لمحاسب شغال في 3 شهور","fine":true,"note":"الوعد واضح."},{"text":"أضمن طريق لأول وظيفة محاسبة","fine":false,"note":"«أضمن» وعد مقدرش نثبته."},{"text":"Excel وOdoo والضرايب في كورس واحد","fine":true,"note":"السعر مطابق."}],"decision":"2 جاهزين، و1 رجع لـ Ads بالبديل"}',true);
set local role service_role;
select is(public.agent_show_card('f5000000-0000-0000-0000-000000000003','review-run-3','call-0','review','مراجعة نصوص إعلانات ديسمبر',current_setting('test.review')::jsonb)->>'state','shown','the Contributor''s review is shown');
select is(public.agent_show_card('f5000000-0000-0000-0000-000000000001','review-run-1','call-0','review',repeat('t',100),
  jsonb_build_object('line',repeat('l',160),'decision',repeat('d',160),'items',(select jsonb_agg(jsonb_build_object('text',repeat('q',240),'fine',n%2=0,'note',repeat('n',240))) from generate_series(1,8) n)))->>'state','shown',
 'the Owner''s review at every limit is shown');
select is(public.agent_show_card('f5000000-0000-0000-0000-000000000002','review-run-2','call-0','review','Hooks review','{"line":"1 text","items":[{"text":"Hook","fine":false,"note":"Too long."}],"decision":"Back to Ads"}')->>'state','shown',
 'and the Manager''s with one text');
select is(public.agent_show_card('f5000000-0000-0000-0000-000000000004','review-run-4','call-0','review','Hooks review',current_setting('test.review')::jsonb)->>'state','refused','a Viewer''s is refused');
select results_eq($$select x.n,public.agent_show_card('f5000000-0000-0000-0000-000000000005','review-run-5','call-'||x.n,'review','Review',x.content::jsonb)->>'state' from (values
  (1,'{"line":"Texts","items":[],"decision":"Done"}'),
  (2,jsonb_build_object('line','Texts','decision','Done','items',(select jsonb_agg(jsonb_build_object('text','Hook','fine',true,'note','Fine')) from generate_series(1,9)))::text),
  (3,jsonb_build_object('line','Texts','decision','Done','items',jsonb_build_array(jsonb_build_object('text',repeat('q',241),'fine',true,'note','Fine')))::text),
  (4,jsonb_build_object('line','Texts','decision','Done','items',jsonb_build_array(jsonb_build_object('text','Hook','fine',true,'note',repeat('n',241))))::text),
  (5,jsonb_build_object('line',repeat('l',161),'decision','Done','items',jsonb_build_array(jsonb_build_object('text','Hook','fine',true,'note','Fine')))::text),
  (6,jsonb_build_object('line','Texts','decision',repeat('d',161),'items',jsonb_build_array(jsonb_build_object('text','Hook','fine',true,'note','Fine')))::text),
  (7,'{"line":"Texts","items":[{"text":"Hook","fine":"true","note":"Fine"}],"decision":"Done"}'),
  (8,'{"line":"Texts","items":[{"text":"Hook","fine":null,"note":"Fine"}],"decision":"Done"}'),
  (9,'{"line":"Texts","items":[{"text":"Hook","fine":true,"note":"Fine"}]}'),
  (10,'{"line":"Texts","items":[{"text":"Hook","fine":true,"note":"Fine"}],"decision":"Done","rows":[]}'),
  (11,'{"line":"Texts","items":[{"text":"Hook","fine":true,"note":"Fine","score":3}],"decision":"Done"}'),
  (12,'{"line":"Texts","items":[{"text":"Hook","fine":true}],"decision":"Done"}'),
  (13,'{"line":"Texts","items":[{"text":" Hook","fine":true,"note":"Fine"}],"decision":"Done"}'),
  (14,'{"line":"Texts","items":{"text":"Hook","fine":true,"note":"Fine"},"decision":"Done"}'),
  (15,'{"line":"Texts","items":["Hook"],"decision":"Done"}'),
  (16,'{"line":"Texts","decision":"Done"}')) x(n,content) order by x.n$$,
 $$select n,'invalid' from generate_series(1,16) n$$,
 'a review with no texts or more than eight, a text, note, line or decision over its limit or untrimmed, a verdict that is not true or false, no decision, or a key out of its shape is not shown');
reset role;
select results_eq($$select run_id,kind,title,jsonb_array_length(content->'items') from public.reply_cards where kind='review' order by run_id$$,
 $$values ('review-run-1','review',repeat('t',100),8),('review-run-2','review','Hooks review',1),('review-run-3','review','مراجعة نصوص إعلانات ديسمبر',3)$$,
 'one card for each review that was shown');
select results_eq($$select (select count(*) from public.work_activity),(select count(*) from public.work_versions),
  (select string_agg(id||':'||status,',' order by id) from public.work_cards)$$,
 $$select activity,versions,cards from work_before$$,
 'showing a review records no Approval or Card activity, moves no Card and adds no Version');
select results_eq($$select actor_id,actor_kind,action,details->'card',details->>'private',details->>'teller' from public.company_log where agent_id='f4000000-0000-0000-0000-000000000002' and source='reply_cards' order by details->>'teller'$$,
 $$values ('f4000000-0000-0000-0000-000000000002'::uuid,'agent','agent_card_shown',jsonb_build_object('kind','review','title',repeat('t',100),'fine',4,'edits',4),'true','20000000-0000-0000-0000-000000000001'),
  ('f4000000-0000-0000-0000-000000000002'::uuid,'agent','agent_card_shown','{"kind":"review","title":"Hooks review","fine":0,"edits":1}'::jsonb,'true','20000000-0000-0000-0000-000000000002'),
  ('f4000000-0000-0000-0000-000000000002'::uuid,'agent','agent_card_shown','{"kind":"review","title":"مراجعة نصوص إعلانات ديسمبر","fine":2,"edits":1}'::jsonb,'true','20000000-0000-0000-0000-000000000003')$$,
 'each review shown is logged once, privately, as the Agent reviewing, with its title and how many texts are fine and how many need an edit');
set local role service_role;
select is(public.agent_show_card('f5000000-0000-0000-0000-000000000001','review-run-1','call-1','draft','Campaign plan','{"line":"Draft · Meta Ads","rows":[]}')->>'state','shown','a draft is still shown');
reset role;
select is((select details->'card' from public.company_log where source='reply_cards' and agent_id='f4000000-0000-0000-0000-000000000002' and details->'card'->>'kind'='draft'),
 '{"kind":"draft","title":"Campaign plan"}'::jsonb,'and its log row keeps only its kind and title');

-- Who reads them: each review only its Conversation's person, the Owner included; each log row its person, the Owner and
-- the Manager.
create temporary table seen(n int, cards int, others int, logged int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*) from public.reply_cards where kind='review'),(select count(*) from public.reply_cards where conversation_id<>'f5000000-0000-0000-0000-000000000001'),(select count(*) from public.company_log where action='agent_card_shown' and details->'card'->>'kind'='review');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*) from public.reply_cards where kind='review'),(select count(*) from public.reply_cards where conversation_id<>'f5000000-0000-0000-0000-000000000002'),(select count(*) from public.company_log where action='agent_card_shown' and details->'card'->>'kind'='review');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*) from public.reply_cards where kind='review'),(select count(*) from public.reply_cards where conversation_id<>'f5000000-0000-0000-0000-000000000003'),(select count(*) from public.company_log where action='agent_card_shown' and details->'card'->>'kind'='review');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*) from public.reply_cards where kind='review'),(select count(*) from public.reply_cards where conversation_id<>'f5000000-0000-0000-0000-000000000004'),(select count(*) from public.company_log where action='agent_card_shown' and details->'card'->>'kind'='review');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 5,(select count(*) from public.reply_cards where kind='review'),(select count(*) from public.reply_cards where conversation_id<>'f5000000-0000-0000-0000-000000000005'),(select count(*) from public.company_log where action='agent_card_shown' and details->'card'->>'kind'='review');
reset role;
select results_eq($$select * from seen order by n$$,$$values (1,1,0,3),(2,1,0,3),(3,1,0,1),(4,0,0,0),(5,0,0,0)$$,
 'each person reads the review of their own Conversation and no other, the Owner included; the log rows are read by their person, the Owner and the Manager, and not by another Contributor or the Viewer');
delete from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000003' and agent_id='f4000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.reply_cards),0,'a Contributor who no longer sees the Agent reads no review of it');
reset role;

select * from finish();
rollback;
