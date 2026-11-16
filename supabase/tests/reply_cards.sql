begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- #136. Ads in RS Learning, shown to the Manager (2), the Contributors (3, 5) and the Viewer (4); the Owner (1) sees every
-- Agent. One Conversation with Ads each, and in it the message of one run.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('e8000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','cards-test','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('e8000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001','Ads','Ads');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e8000000-0000-0000-0000-000000000002' from generate_series(2,5) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('e9000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e8000000-0000-0000-0000-000000000002','Ads' from generate_series(1,5) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('e9000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone','Plan the December campaign',gen_random_uuid(),'card-run-'||n from generate_series(1,5) n;

-- A run is pinned at its first start with the text of the tools its person is offered: show_draft goes beside the tools
-- the run had, for an Owner, a Manager and a Contributor, and a Viewer is offered nothing.
select set_config('test.specs','{"create_agent":"{\"name\":\"create_agent\"}","save_rule":"{\"name\":\"save_rule\"}","suggest_rule":"{\"name\":\"suggest_rule\"}","show_draft":"{\"name\":\"show_draft\"}"}',true);
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 select ('e9000000-0000-0000-0000-00000000000'||n)::uuid,('ea000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001',
  ('20000000-0000-0000-0000-00000000000'||n)::uuid,'e8000000-0000-0000-0000-000000000002','Plan the December campaign','cards-test' from generate_series(1,4) n;
select public.pinned_run_note(('e9000000-0000-0000-0000-00000000000'||n)::uuid,('ea000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid) from generate_series(1,4) n;
set local role service_role;
select results_eq($$select public.pin_run(('e9000000-0000-0000-0000-00000000000'||n)::uuid,('ea000000-0000-0000-0000-00000000000'||n)::uuid,current_setting('test.specs')::jsonb)->>'tools' from generate_series(1,4) n order by n$$,
 $$values ('[{"name":"save_rule"},{"name":"show_draft"}]'),('[{"name":"save_rule"},{"name":"show_draft"}]'),('[{"name":"suggest_rule"},{"name":"show_draft"}]'),(null)$$,
 'the Owner''s and the Manager''s runs are offered show_draft after save_rule, the Contributor''s after suggest_rule, and the Viewer''s nothing');
select is(public.pin_run('e9000000-0000-0000-0000-000000000003','ea000000-0000-0000-0000-000000000003','{"suggest_rule":"{\"name\":\"suggest_rule\"}"}')->>'tools','[{"name":"suggest_rule"},{"name":"show_draft"}]',
 'a retry sends what was first pinned');
reset role;

-- The call is carried out once for its run and call, however often the run is closed.
select set_config('test.draft','{"line":"Draft · Meta Ads","rows":[{"label":"Goal","value":"WhatsApp leads"},{"label":"Budget","value":"EGP 500 a day"}]}',true);
set local role service_role;
select is(public.agent_show_card('e9000000-0000-0000-0000-000000000003','card-run-3','call-0','draft','Campaign plan',current_setting('test.draft')::jsonb)->>'state','shown','the Contributor''s draft is shown');
reset role;
select set_config('test.card',(select id::text from public.reply_cards where run_id='card-run-3'),true);
set local role service_role;
select is(public.agent_show_card('e9000000-0000-0000-0000-000000000003','card-run-3','call-0','draft','Something else','{"line":"Else","rows":[]}'),jsonb_build_object('state','shown','card',current_setting('test.card')::bigint),
 'closing the run again answers the same card');
select is(public.agent_show_card('e9000000-0000-0000-0000-000000000001','card-run-1','call-0','draft',repeat('t',100),
  jsonb_build_object('line',repeat('l',160),'rows',(select jsonb_agg(jsonb_build_object('label',repeat('k',40),'value',repeat('v',240))) from generate_series(1,8))))->>'state','shown',
 'the Owner''s draft at every limit is shown');
select is(public.agent_show_card('e9000000-0000-0000-0000-000000000002','card-run-2','call-0','draft','Campaign plan','{"line":"Draft · Meta Ads","rows":[]}')->>'state','shown','and the Manager''s with no rows');
select is(public.agent_show_card('e9000000-0000-0000-0000-000000000004','card-run-4','call-0','draft','Campaign plan',current_setting('test.draft')::jsonb)->>'state','refused','a Viewer''s is refused');
select is(public.agent_show_card('e9000000-0000-0000-0000-000000000003','card-run-9','call-0','draft','Campaign plan',current_setting('test.draft')::jsonb)->>'state','refused','a run that is not in the Conversation shows nothing');
select results_eq($$select x.n,public.agent_show_card('e9000000-0000-0000-0000-000000000005','card-run-5','call-'||x.n,x.kind,x.title,x.content::jsonb)->>'state' from (values
  (1,'draft',null,'{"line":"Draft","rows":[]}'),(2,'draft','','{"line":"Draft","rows":[]}'),(3,'draft',' Campaign plan','{"line":"Draft","rows":[]}'),(4,'draft',repeat('t',101),'{"line":"Draft","rows":[]}'),
  (5,'draft','Plan','{"rows":[]}'),(6,'draft','Plan',jsonb_build_object('line',repeat('l',161),'rows','[]'::jsonb)::text),(7,'draft','Plan','{"line":3,"rows":[]}'),
  (8,'draft','Plan',jsonb_build_object('line','Draft','rows',(select jsonb_agg(jsonb_build_object('label','Goal','value','Leads')) from generate_series(1,9)))::text),
  (9,'draft','Plan',jsonb_build_object('line','Draft','rows',jsonb_build_array(jsonb_build_object('label',repeat('k',41),'value','Leads')))::text),
  (10,'draft','Plan',jsonb_build_object('line','Draft','rows',jsonb_build_array(jsonb_build_object('label','Goal','value',repeat('v',241))))::text),
  (11,'draft','Plan','{"line":"Draft","rows":[{"label":"Goal"}]}'),(12,'draft','Plan','{"line":"Draft","rows":[],"total":"EGP 15,000"}'),(13,'draft','Plan','{"line":"Draft","rows":"Goal"}'),
  (14,'draft','Plan','"Draft"'),(15,'nope','Plan','{"line":"Draft","rows":[]}')) x(n,kind,title,content) order by x.n$$,
 $$select n,'invalid' from generate_series(1,15) n$$,
 'a card with no title or line, text over its limit or untrimmed, more than eight rows, a row or a key out of its shape, or an unknown kind is not shown');
reset role;
select throws_ok($$insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content) values
 ('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000005','card-run-5','call-0','nope','Plan','{"line":"Draft","rows":[]}')$$,'23514',null,
 'no row holds a kind the database does not know, whoever writes it');
select results_eq($$select run_id,call_id,kind,title,state,jsonb_array_length(content->'rows') from public.reply_cards order by run_id$$,
 $$values ('card-run-1','call-0','draft',repeat('t',100),'shown',8),('card-run-2','call-0','draft','Campaign plan','shown',0),('card-run-3','call-0','draft','Campaign plan','shown',2)$$,
 'one card for each run and call that was shown, as it was first shown');
select results_eq($$select actor_id,actor_kind,action,details->'card',details->>'private',details->>'teller' from public.company_log where agent_id='e8000000-0000-0000-0000-000000000002' and source='reply_cards' order by details->>'teller'$$,
 $$values ('e8000000-0000-0000-0000-000000000002'::uuid,'agent','agent_card_shown',jsonb_build_object('kind','draft','title',repeat('t',100)),'true','20000000-0000-0000-0000-000000000001'),
  ('e8000000-0000-0000-0000-000000000002'::uuid,'agent','agent_card_shown','{"kind":"draft","title":"Campaign plan"}'::jsonb,'true','20000000-0000-0000-0000-000000000002'),
  ('e8000000-0000-0000-0000-000000000002'::uuid,'agent','agent_card_shown','{"kind":"draft","title":"Campaign plan"}'::jsonb,'true','20000000-0000-0000-0000-000000000003')$$,
 'each card shown is logged once, privately, as the Agent delivering it, with its kind and title');

-- Who reads them: each card only its Conversation's person, the Owner included; each log row its person, the Owner and
-- the Manager.
create temporary table seen(n int, cards int, others int, logged int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*) from public.reply_cards),(select count(*) from public.reply_cards where conversation_id<>'e9000000-0000-0000-0000-000000000001'),(select count(*) from public.company_log where action='agent_card_shown');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*) from public.reply_cards),(select count(*) from public.reply_cards where conversation_id<>'e9000000-0000-0000-0000-000000000002'),(select count(*) from public.company_log where action='agent_card_shown');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*) from public.reply_cards),(select count(*) from public.reply_cards where conversation_id<>'e9000000-0000-0000-0000-000000000003'),(select count(*) from public.company_log where action='agent_card_shown');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*) from public.reply_cards),(select count(*) from public.reply_cards where conversation_id<>'e9000000-0000-0000-0000-000000000004'),(select count(*) from public.company_log where action='agent_card_shown');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 5,(select count(*) from public.reply_cards),(select count(*) from public.reply_cards where conversation_id<>'e9000000-0000-0000-0000-000000000005'),(select count(*) from public.company_log where action='agent_card_shown');
reset role;
select results_eq($$select * from seen order by n$$,$$values (1,1,0,3),(2,1,0,3),(3,1,0,1),(4,0,0,0),(5,0,0,0)$$,
 'each person reads the card of their own Conversation and no other, the Owner included; the log rows are read by their person, the Owner and the Manager, and not by another Contributor or the Viewer');
delete from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000003' and agent_id='e8000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.reply_cards),0,'a Contributor who no longer sees the Agent reads no card of it');
reset role;

select * from finish();
rollback;
