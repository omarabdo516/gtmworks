begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
-- #648. A question where several choices may be picked: its person picks two of four, sent as one answer the Engine
-- takes, or answers in words. Ads in RS Learning, one Conversation with the Contributor (3), one run asking.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('f1000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Ads','Ads','picks-test');
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','f1000000-0000-0000-0000-000000000002');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('f2000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','f1000000-0000-0000-0000-000000000002','Ads' from generate_series(1,3) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('f2000000-0000-0000-0000-00000000000'||n)::uuid,'person','20000000-0000-0000-0000-000000000003','Someone','Plan the December campaign',gen_random_uuid(),'m-run-'||n from generate_series(1,3) n;
set local role service_role;
select public.track_run_question(('f2000000-0000-0000-0000-00000000000'||n)::uuid,'m-run-'||n,
 '{"id":"m1@1","text":"Which of them do we make now?","choices":["Reel","Carousel","Story","Post"],"multiple":true}',false,'2026-06-10T10:14:00Z') from generate_series(1,2) n;
reset role;
select set_config('test.card',(select id::text from public.reply_cards where conversation_id='f2000000-0000-0000-0000-000000000001'),true);

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,1,null,'f3000000-0000-0000-0000-000000000001')$$,
 '22023','questionAnswerInvalid','one choice alone is not how a several-pick question is picked');
select throws_ok($$select public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'f3000000-0000-0000-0000-000000000001',array[]::int[])$$,
 '22023','questionAnswerInvalid','no pick at all is refused');
select throws_ok($$select public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'f3000000-0000-0000-0000-000000000001',array[0,4])$$,
 '22023','questionAnswerInvalid','a pick past the last choice is refused');
select throws_ok($$select public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'f3000000-0000-0000-0000-000000000001',array[1,1])$$,
 '22023','questionAnswerInvalid','the same choice twice is refused');
select results_eq($$values
  (public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'f3000000-0000-0000-0000-000000000001',array[2,0])),
  (public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'f3000000-0000-0000-0000-000000000001',array[2,0]))$$,
 $$values ('claimed'),('claimed')$$,'the person picks two of the four, and the same send again finds its own claim');
select is(public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000002',null,null,'Only the reel, this week','f3000000-0000-0000-0000-000000000002'),'claimed',
 'typed words answer a several-pick question as written');
reset role;
select results_eq($$select conversation_id,content->'answer' from public.reply_cards where kind='question' and run_id in ('m-run-1','m-run-2') order by conversation_id$$,
 $$values ('f2000000-0000-0000-0000-000000000001'::uuid,'["Reel","Story"]'::jsonb),('f2000000-0000-0000-0000-000000000002'::uuid,'"Only the reel, this week"'::jsonb)$$,
 'the picks are kept as the choices'' own texts, in the order they were offered; typed words as written');

-- Two choices that read alike are one answer text, kept once.
reset role;
set local role service_role;
select public.track_run_question('f2000000-0000-0000-0000-000000000003','m-run-3','{"id":"m3@1","text":"Which?","choices":["Reel","Reel","Post"],"multiple":true}',false,'2026-06-10T10:14:00Z');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select public.answer_question('10000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000003',(select id from public.reply_cards where call_id='m3@1'),null,null,'f3000000-0000-0000-0000-000000000003',array[2,1,0]);
reset role;
select is((select content->'answer' from public.reply_cards where call_id='m3@1'),'["Reel","Post"]'::jsonb,'two choices that read alike are kept once, at the first of them');

-- The closer hands the picks over as they are kept, and the answer the Engine took is logged with them.
set local role service_role;
select is(public.track_run_question('f2000000-0000-0000-0000-000000000001','m-run-1',
  '{"id":"m1@1","text":"Which of them do we make now?","choices":["Reel","Carousel","Story","Post"],"multiple":true}',false,'2026-06-10T10:16:00Z'),
 jsonb_build_array(jsonb_build_object('card',current_setting('test.card')::bigint,'question','m1@1','answer',jsonb_build_array('Reel','Story'))),'the next read hands over the picks to deliver');
select public.settle_question(current_setting('test.card')::bigint,'answered');
reset role;
select is((select details->'question'->'answer' from public.company_log where source='reply_card_answers' and source_id=current_setting('test.card')::bigint),
 '["Reel","Story"]'::jsonb,'the answer is logged with its picks');

select * from finish();
rollback;
