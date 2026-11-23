begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
-- #651. A channel's question where several choices may be picked: any Member of the channel who may write picks two of
-- four, sent as one answer the Engine takes. Ads in RS Learning's general channel, shown to the Contributors (3, 5);
-- Viewer 4 reads it. One message asks a several-pick question and one a single-pick one.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e6510000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','e6518000-0000-0000-0000-000000000001','Ads','Ads',false,'channel-picks-ads');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e6510000-0000-0000-0000-000000000001' from generate_series(2,5) n;
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','@Ads which formats?','e6511000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','@Ads which angle?','e6511000-0000-0000-0000-000000000002');
select set_config('test.many',(select id::text from public.channel_messages where send_key='e6511000-0000-0000-0000-000000000001'),true);
select set_config('test.one',(select id::text from public.channel_messages where send_key='e6511000-0000-0000-0000-000000000002'),true);
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at)
 select id,1,company_id,channel_id,'e6510000-0000-0000-0000-000000000001','Ads',gen_random_uuid(),body,
  case send_key when 'e6511000-0000-0000-0000-000000000001' then 'run-many' else 'run-one' end,'channel-picks-ads',1,now()
 from public.channel_messages where send_key in ('e6511000-0000-0000-0000-000000000001','e6511000-0000-0000-0000-000000000002');
select set_config('test.q','{"id":"q-many","text":"Which of them do we make now?","choices":["Reel","Carousel","Story","Post"],"multiple":true}',true);
set local role service_role;
select public.track_channel_question(current_setting('test.many')::bigint,'run-many',current_setting('test.q')::jsonb,false,'2026-06-10T10:14:00Z');
select public.track_channel_question(current_setting('test.one')::bigint,'run-one','{"id":"q-one","text":"Which angle?","choices":["Graduates","Parents"],"multiple":false}',false,'2026-06-10T10:14:00Z');
reset role;
select set_config('test.card',(select id::text from public.reply_cards where call_id='q-many'),true);
select set_config('test.onecard',(select id::text from public.reply_cards where call_id='q-one'),true);

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,1,null,'e6512000-0000-0000-0000-000000000001')$$,
 '22023','questionAnswerInvalid','one choice alone is not how a several-pick question is picked');
select throws_ok($$select public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'e6512000-0000-0000-0000-000000000001',array[]::int[])$$,
 '22023','questionAnswerInvalid','no pick at all is refused');
select throws_ok($$select public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'e6512000-0000-0000-0000-000000000001',array[0,4])$$,
 '22023','questionAnswerInvalid','a pick past the last choice is refused');
select throws_ok($$select public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'e6512000-0000-0000-0000-000000000001',array[1,1])$$,
 '22023','questionAnswerInvalid','the same choice twice is refused');
select throws_ok($$select public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,0,null,'e6512000-0000-0000-0000-000000000001',array[1])$$,
 '22023','questionAnswerInvalid','picks are the whole answer');
select throws_ok($$select public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',current_setting('test.onecard')::bigint,null,null,'e6512000-0000-0000-0000-000000000001',array[0,1])$$,
 '22023','questionAnswerInvalid','a question with one answer takes no picks');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'e6512000-0000-0000-0000-000000000002',array[0])$$,
 '42501','channelNotAllowed','a Viewer cannot send picks');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$values
  (public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'e6512000-0000-0000-0000-000000000003',array[2,0])),
  (public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'e6512000-0000-0000-0000-000000000003',array[2,0]))$$,
 $$values ('claimed'),('claimed')$$,'a Contributor picks two of the four, and the same send again finds its own claim');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,null,null,'e6512000-0000-0000-0000-000000000004',array[1]),
 'taken','a second Member''s picks change nothing');
reset role;
select results_eq($$select state,answered_by,content->'answer' from public.reply_cards where id=current_setting('test.card')::bigint$$,
 $$values ('sending','20000000-0000-0000-0000-000000000003'::uuid,'["Reel","Story"]'::jsonb)$$,
 'the picks are kept as the choices'' own texts, in the order they were offered, with who sent them');

-- The closer hands the picks over as they are kept, and the answer the Engine took is logged with them.
set local role service_role;
select is(public.track_channel_question(current_setting('test.many')::bigint,'run-many',current_setting('test.q')::jsonb,false,'2026-06-10T10:16:00Z'),
 jsonb_build_array(jsonb_build_object('card',current_setting('test.card')::bigint,'question','q-many','answer',jsonb_build_array('Reel','Story'))),'the next read hands over the picks to deliver');
select is(public.settle_channel_question(current_setting('test.card')::bigint,'answered'),'answered');
reset role;
select is((select details->'question'->'answer' from public.company_log where source='reply_card_answers' and source_id=current_setting('test.card')::bigint),
 '["Reel","Story"]'::jsonb,'the answer is logged with its picks');

select * from finish();
rollback;
