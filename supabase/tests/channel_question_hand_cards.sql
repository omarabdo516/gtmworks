begin;
create extension if not exists pgtap with schema extensions;
select plan(63);
-- #149. Ads in RS Learning's general channel, shown to the Manager (2) and the Contributors (3, 5); the Owner (1) sees
-- every Agent and Viewer 4 none. Lead is the main Agent. A team channel "scripts" holds Contributor 3 and Viewer 4 and
-- the hidden Ads; the Manager and another Contributor are outside it, and Karim is a Manager of Aleem only.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e9150000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','e9158000-0000-0000-0000-000000000001','Ads','Ads',false,'channel-question-ads'),
 ('e9150000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e9158000-0000-0000-0000-000000000002','Lead','General',true,'channel-question-lead');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e9150000-0000-0000-0000-000000000001' from generate_series(2,5) n;
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('e9150000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','team','scripts','20000000-0000-0000-0000-000000000003','e9157000-0000-0000-0000-000000000001');
insert into public.channel_people(channel_id,company_id,person_id,added_by) values
 ('e9150000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003'),
 ('e9150000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000003');
insert into public.channel_agents(channel_id,company_id,agent_id,added_by) values
 ('e9150000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','e9150000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003');
insert into auth.users(id,email) values ('e9159000-0000-0000-0000-000000000001','karim.questions@example.test');
insert into public.people(id,name) values ('e9159000-0000-0000-0000-000000000001','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','e9159000-0000-0000-0000-000000000001','manager');

-- The messages whose Runs ask a question or hand a step over, and their Runs.
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','@Ads which angle?','e9151000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000002','مدير','@Lead which angle?','e9151000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','@Ads hand me the publish','e9151000-0000-0000-0000-000000000003'),
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000005','عضو','@Ads pick one','e9151000-0000-0000-0000-000000000004'),
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000005','عضو','@Ads pick the other','e9151000-0000-0000-0000-000000000005'),
 ('10000000-0000-0000-0000-000000000001','e9150000-0000-0000-0000-000000000011','person','20000000-0000-0000-0000-000000000003','مراجع','@Ads in the team','e9151000-0000-0000-0000-000000000006');
select set_config('test.ads',(select id::text from public.channel_messages where send_key='e9151000-0000-0000-0000-000000000001'),true);
select set_config('test.lead',(select id::text from public.channel_messages where send_key='e9151000-0000-0000-0000-000000000002'),true);
select set_config('test.hand',(select id::text from public.channel_messages where send_key='e9151000-0000-0000-0000-000000000003'),true);
select set_config('test.end',(select id::text from public.channel_messages where send_key='e9151000-0000-0000-0000-000000000004'),true);
select set_config('test.late',(select id::text from public.channel_messages where send_key='e9151000-0000-0000-0000-000000000005'),true);
select set_config('test.team',(select id::text from public.channel_messages where send_key='e9151000-0000-0000-0000-000000000006'),true);
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at)
 select id,1,company_id,channel_id,'e9150000-0000-0000-0000-000000000001','Ads',gen_random_uuid(),body,
  case send_key when 'e9151000-0000-0000-0000-000000000001' then 'run-ads' when 'e9151000-0000-0000-0000-000000000003' then 'run-hand'
   when 'e9151000-0000-0000-0000-000000000004' then 'run-end' when 'e9151000-0000-0000-0000-000000000005' then 'run-late' else 'run-team' end,
  'channel-question-ads',1,now()
 from public.channel_messages where send_key in ('e9151000-0000-0000-0000-000000000001','e9151000-0000-0000-0000-000000000003','e9151000-0000-0000-0000-000000000004','e9151000-0000-0000-0000-000000000005','e9151000-0000-0000-0000-000000000006');
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at)
 select id,1,company_id,channel_id,'e9150000-0000-0000-0000-000000000002','Lead',gen_random_uuid(),body,'run-lead','channel-question-lead',1,now()
 from public.channel_messages where send_key='e9151000-0000-0000-0000-000000000002';

-- The questions a channel's Runs ask are kept once, linked to the message and the place of the Run: the main Agent's
-- own question names the Member whose message it answers, and any other Agent's asks the whole team. A handed step is
-- kept open.
select set_config('test.q','{"id":"q-ads","text":"Which angle first?","choices":["Graduates","Parents"],"multiple":false}',true);
select set_config('test.lq','{"id":"q-lead","text":"Which angle for Lead?","choices":["A","B"],"multiple":false}',true);
select set_config('test.tq','{"id":"q-team","text":"Which angle in the team?","choices":["One","Two"],"multiple":false}',true);
set local role service_role;
select is(public.track_channel_question(current_setting('test.ads')::bigint,'run-ads',current_setting('test.q')::jsonb,false,'2026-01-01T00:00:00Z'::timestamptz)::text,'[]',
 'a channel Run''s question is kept, and nothing is claimed yet');
select is(public.track_channel_question(current_setting('test.lead')::bigint,'run-lead',current_setting('test.lq')::jsonb,false,'2026-01-01T00:00:00Z'::timestamptz)::text,'[]',
 'the main Agent''s question is kept too');
select is(public.track_channel_question(current_setting('test.ads')::bigint,'run-ads',current_setting('test.q')::jsonb,false,'2026-01-01T00:01:00Z'::timestamptz)::text,'[]',
 'the same read again claims nothing more');
select is(public.channel_show_card(current_setting('test.hand')::bigint,'run-hand','call-hand','hand','Publish the article',
 '{"app":"WordPress","line":"The draft is ready","rows":[]}'::jsonb)->>'state','shown','a channel Run hands a step to the team');
reset role;
select is((select count(*)::int from public.reply_cards where channel_message_id=current_setting('test.ads')::bigint and kind='question'),1,'one card is kept for the question');
select is((select state from public.reply_cards where channel_message_id=current_setting('test.ads')::bigint and kind='question'),'open','open for the team');
select is((select addressed_to from public.reply_cards where channel_message_id=current_setting('test.ads')::bigint and kind='question'),null::uuid,'an Agent that is not the main one asks the whole team');
select is((select addressed_to from public.reply_cards where channel_message_id=current_setting('test.lead')::bigint and kind='question'),
 '20000000-0000-0000-0000-000000000002'::uuid,'the main Agent''s question is addressed to the Member whose message it answers');
select set_config('test.handcard',(select id::text from public.reply_cards where channel_message_id=current_setting('test.hand')::bigint and kind='hand'),true);
select set_config('test.adscard',(select id::text from public.reply_cards where channel_message_id=current_setting('test.ads')::bigint and kind='question'),true);
select set_config('test.leadcard',(select id::text from public.reply_cards where channel_message_id=current_setting('test.lead')::bigint and kind='question'),true);
select is((select state from public.reply_cards where id=current_setting('test.handcard')::bigint),'open','the handed step waits, open, for the team''s Done it');
select is((select count(*)::int from public.company_log where source='reply_cards' and source_id=current_setting('test.handcard')::bigint),0,'a handed step shown writes no log row: its one row is the press');

-- "Waiting on you": one item for every Member of the channel who may write (the main Agent's question only for the
-- Member it was addressed to), and none for a Viewer.
create temporary table seen(step text, n int, questions int, hands int, asked_lead boolean);
grant insert on seen to authenticated;
create function pg_temp.look(step text) returns void language plpgsql as $$
begin
 for n in 1..5 loop
  perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-00000000000'||n,true);
  insert into seen select step,n,
   (select count(*) from public.waiting_list('10000000-0000-0000-0000-000000000001') w where w.kind='channel_question'),
   (select count(*) from public.waiting_list('10000000-0000-0000-0000-000000000001') w where w.kind='channel_hand'),
   exists(select 1 from public.waiting_list('10000000-0000-0000-0000-000000000001') w where w.kind='channel_question' and w.id=current_setting('test.leadcard')::bigint);
 end loop;
end $$;
grant execute on function pg_temp.look(text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select pg_temp.look('before');
reset role;
select results_eq($$select n,questions,hands,asked_lead from seen where step='before' order by n$$,
 $$values (1,1,1,false),(2,2,1,true),(3,1,1,false),(4,0,0,false),(5,1,1,false)$$,
 'every writer has the team''s question and handed step, the main Agent''s question is the Manager''s alone, and the Viewer has neither');

-- Any writer answers; the first answer wins for everyone and the record names who gave it. The main Agent's question is
-- its own Member's to answer.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.adscard')::bigint,0,null,'e9152000-0000-0000-0000-000000000001')$$,'42501','channelNotAllowed','a Viewer cannot answer a channel question');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.adscard')::bigint,1,null,'e9152000-0000-0000-0000-000000000002'),'claimed','a Contributor on the team answers it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.adscard')::bigint,0,null,'e9152000-0000-0000-0000-000000000003'),'taken','a second answer, by anyone, changes nothing');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.adscard')::bigint,1,null,'e9152000-0000-0000-0000-000000000002'),'claimed','the same key again is the same claim');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.leadcard')::bigint,0,null,'e9152000-0000-0000-0000-000000000004')$$,'42501','channelNotAllowed','the main Agent''s question is not the Owner''s to answer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.leadcard')::bigint,0,null,'e9152000-0000-0000-0000-000000000005')$$,'42501','channelNotAllowed','nor another Contributor''s');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.leadcard')::bigint,1,null,'e9152000-0000-0000-0000-000000000006'),'claimed','the Member it was addressed to answers it');
reset role;
select results_eq($$select state,answered_by,content->>'answer' from public.reply_cards where id=current_setting('test.adscard')::bigint$$,
 $$values ('sending','20000000-0000-0000-0000-000000000005'::uuid,'Parents')$$,'the first answer is the one kept, and the record names who gave it');
select results_eq($$select state,answered_by,content->>'answer' from public.reply_cards where id=current_setting('test.leadcard')::bigint$$,
 $$values ('sending','20000000-0000-0000-0000-000000000002'::uuid,'B')$$,'and the main Agent''s question keeps its own Member''s answer');

-- Delivered answers settle once and are logged as the Member who gave them.
set local role service_role;
select is(public.settle_channel_question(current_setting('test.adscard')::bigint,'answered'),'answered');
select is(public.settle_channel_question(current_setting('test.leadcard')::bigint,'answered'),'answered');
reset role;
select results_eq($$select actor_id,action from public.company_log where source='reply_card_answers' and action='agent_question_answered' order by id$$,
 $$values ('20000000-0000-0000-0000-000000000005'::uuid,'agent_question_answered'),('20000000-0000-0000-0000-000000000002'::uuid,'agent_question_answered')$$,
 'each answer is logged once, as the Member who gave it');

-- "Done it" is the team's: once, by any writer, with who and when, and it asks the Agent to pick up as a Run of the
-- channel. A Viewer is refused and a second press changes nothing.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.mark_channel_hand_done('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.handcard')::bigint)$$,'42501','channelNotAllowed','a Viewer cannot press Done it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.mark_channel_hand_done('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.handcard')::bigint)->>'first','true','a Contributor presses Done it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.mark_channel_hand_done('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.handcard')::bigint)->>'first','false','a second press, by another Member, answers the first record');
reset role;
select results_eq($$select state,done_by from public.reply_cards where id=current_setting('test.handcard')::bigint$$,
 $$values ('done','20000000-0000-0000-0000-000000000005'::uuid)$$,'the step is done, with who did it');
select is((select count(*)::int from public.channel_messages where hand_card=current_setting('test.handcard')::bigint),1,'one quiet message asks its Agent to pick up');
select is((select count(*)::int from public.channel_runs r join public.channel_messages m on m.id=r.message_id
 where m.hand_card=current_setting('test.handcard')::bigint and r.outcome is null),1,'and one Run of that Agent waits in the channel');
select results_eq($$select actor_id,action from public.company_log where source='reply_card_answers' and action='agent_hand_done'$$,
 $$values ('20000000-0000-0000-0000-000000000005'::uuid,'agent_hand_done')$$,'the press is logged once, as the Member who did it');

-- #354: the quiet message "Done it" writes is never new: the transcript draws nothing of it, so it raises no badge. The
-- Agent's reply that follows it is an ordinary message, and counts.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.read_channel('69000000-0000-0000-0000-000000000001',
 (select max(id) from public.channel_messages where channel_id='69000000-0000-0000-0000-000000000001' and hand_card is null));
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id='69000000-0000-0000-0000-000000000001'),0,
 'the quiet pickup message is not new to another Member');
reset role;
set local role service_role;
select ok(public.close_channel_run(current_setting('test.ads')::bigint,'run-ads','completed','Ads picked it up.',null,null),'the Agent answers the message the quiet one asked about');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id='69000000-0000-0000-0000-000000000001'),1,
 'while its reply is a message the channel shows, and counts');
reset role;

-- What one Member acts on leaves every Member's list.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select pg_temp.look('after');
reset role;
select results_eq($$select n,questions,hands,asked_lead from seen where step='after' order by n$$,
 $$values (1,0,0,false),(2,0,0,false),(3,0,0,false),(4,0,0,false),(5,0,0,false)$$,
 'the answered question and the done step leave every writer''s list, and nothing waits on the Viewer');

-- A team channel: its own Members read the question and the answer's log row, a Viewer included; a Member of the Company
-- outside it reads neither, and neither does another Company. Only a Member of the channel answers it.
set local role service_role;
select is(public.track_channel_question(current_setting('test.team')::bigint,'run-team',current_setting('test.tq')::jsonb,false,'2026-01-01T00:00:00Z'::timestamptz)::text,'[]',
 'a team channel''s question is kept for its own Members');
reset role;
select set_config('test.teamcard',(select id::text from public.reply_cards where channel_message_id=current_setting('test.team')::bigint and kind='question'),true);
create temporary table readers(who text, cards int);
grant insert on readers to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into readers select 'member',(select count(*)::int from public.reply_cards where id=current_setting('test.teamcard')::bigint);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into readers select 'viewer',(select count(*)::int from public.reply_cards where id=current_setting('test.teamcard')::bigint);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into readers select 'outside',(select count(*)::int from public.reply_cards where id=current_setting('test.teamcard')::bigint);
select set_config('request.jwt.claim.sub','e9159000-0000-0000-0000-000000000001',true);
insert into readers select 'elsewhere',(select count(*)::int from public.reply_cards where id=current_setting('test.teamcard')::bigint);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.answer_channel_question('10000000-0000-0000-0000-000000000001','e9150000-0000-0000-0000-000000000011',
 current_setting('test.teamcard')::bigint,0,null,'e9152000-0000-0000-0000-000000000007')$$,'P0002','channelNotFound','a Member outside the channel cannot answer its question');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.answer_channel_question('10000000-0000-0000-0000-000000000001','e9150000-0000-0000-0000-000000000011',
 current_setting('test.teamcard')::bigint,0,null,'e9152000-0000-0000-0000-000000000008'),'claimed','its own Member answers it');
reset role;
set local role service_role;
select is(public.settle_channel_question(current_setting('test.teamcard')::bigint,'answered'),'answered');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into readers select 'viewer_log',(select count(*)::int from public.company_log where source='reply_card_answers' and source_id=current_setting('test.teamcard')::bigint);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into readers select 'outside_log',(select count(*)::int from public.company_log where source='reply_card_answers' and source_id=current_setting('test.teamcard')::bigint);
select set_config('request.jwt.claim.sub','e9159000-0000-0000-0000-000000000001',true);
insert into readers select 'elsewhere_log',(select count(*)::int from public.company_log where source='reply_card_answers' and source_id=current_setting('test.teamcard')::bigint);
reset role;
select results_eq($$select who,cards from readers where who in ('member','viewer','outside','elsewhere') order by who$$,
 $$values ('elsewhere',0),('member',1),('outside',0),('viewer',1)$$,'the channel''s Members read its question, a Viewer included, and a Member outside it and another Company read none');
select results_eq($$select who,cards from readers where who in ('viewer_log','outside_log','elsewhere_log') order by who$$,
 $$values ('elsewhere_log',0),('outside_log',0),('viewer_log',1)$$,'the answer''s log row is read by the channel''s Viewer, and by no one outside the channel');

-- #354: whether an id is a channel card is not a fact a caller outside that channel learns. reply_card_in_channel answers
-- false for every caller outside the card's channel; the log's general branch leaves a channel card's row out through
-- reply_card_in_other_channel, which is false to anyone outside the Company and to any id that is no channel card.
set local role authenticated;
select set_config('request.jwt.claim.sub','e9159000-0000-0000-0000-000000000001',true);
select is(public.reply_card_in_channel(current_setting('test.teamcard')::bigint),false,'a Manager of another Company cannot tell a channel card from any id');
select is(public.reply_card_in_other_channel(current_setting('test.teamcard')::bigint),false,'nor is it told the card belongs to a channel at all');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.reply_card_in_channel(current_setting('test.teamcard')::bigint),false,'a Manager of the Company outside the channel is answered false too');
select is(public.reply_card_in_other_channel(current_setting('test.teamcard')::bigint),true,'so the log''s general branch leaves the row out for them');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.reply_card_in_channel(current_setting('test.teamcard')::bigint),true,'and only its own Member reads the card');
reset role;

-- A Run's end closes its own questions, and an answer the Engine took still wins over the card it closed.
set local role service_role;
select is(public.track_channel_question(current_setting('test.end')::bigint,'run-end',current_setting('test.q')::jsonb,false,'2026-01-01T00:00:00Z'::timestamptz)::text,'[]','another Run keeps its question');
reset role;
select set_config('test.endcard',(select id::text from public.reply_cards where channel_message_id=current_setting('test.end')::bigint and kind='question'),true);
update public.channel_runs set outcome='failed',closed_at=now() where run_id='run-end';
select is((select state from public.reply_cards where id=current_setting('test.endcard')::bigint),'closed','the Run''s end closes its question');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.endcard')::bigint,0,null,'e9152000-0000-0000-0000-000000000009'),'closed','and nobody can answer it any more');
reset role;
set local role service_role;
select is(public.track_channel_question(current_setting('test.late')::bigint,'run-late',current_setting('test.q')::jsonb,false,'2026-01-01T00:00:00Z'::timestamptz)::text,'[]','a claimed answer waits on its Run');
reset role;
select set_config('test.latecard',(select id::text from public.reply_cards where channel_message_id=current_setting('test.late')::bigint and kind='question'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.answer_channel_question('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.latecard')::bigint,0,null,'e9152000-0000-0000-0000-000000000010'),'claimed','the Member claims it');
reset role;
update public.channel_runs set outcome='failed',closed_at=now() where run_id='run-late';
select is((select state from public.reply_cards where id=current_setting('test.latecard')::bigint),'closed','its Run''s end closes it with the answer kept');
set local role service_role;
select is(public.settle_channel_question(current_setting('test.latecard')::bigint,'answered'),'answered','and a delivery the Engine took still settles it answered');
reset role;
select is((select state||':'||answered_by::text from public.reply_cards where id=current_setting('test.latecard')::bigint),
 'answered:20000000-0000-0000-0000-000000000005','the record keeps the answer and who gave it');

-- #354: "Done it" starts the pickup Run only for an Agent the presser may call in that channel. One since removed from
-- the channel, or one hidden from them, starts none; the step is still recorded as done and asks nothing.
set local role service_role;
select is(public.channel_show_card(current_setting('test.team')::bigint,'run-team','call-team-hand','hand','Publish in the team',
 '{"app":"WordPress","line":"The draft is ready","rows":[]}'::jsonb)->>'state','shown','a team channel''s Run hands a step over too');
reset role;
select set_config('test.teamhand',(select id::text from public.reply_cards where channel_message_id=current_setting('test.team')::bigint and kind='hand'),true);
delete from public.channel_agents where channel_id='e9150000-0000-0000-0000-000000000011' and agent_id='e9150000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.mark_channel_hand_done('10000000-0000-0000-0000-000000000001','e9150000-0000-0000-0000-000000000011',
 current_setting('test.teamhand')::bigint)->>'first','true','a Contributor presses Done it on a step of an Agent since removed from the channel');
reset role;
select is((select state from public.reply_cards where id=current_setting('test.teamhand')::bigint),'done','the step is still recorded as done');
select is((select count(*)::int from public.channel_messages where hand_card=current_setting('test.teamhand')::bigint),0,'and no quiet message asks the Agent to pick up');
select is((select count(*)::int from public.channel_runs where message_id=current_setting('test.team')::bigint),1,'no pickup Run starts');
delete from public.member_agent_access where company_id='10000000-0000-0000-0000-000000000001'
 and person_id='20000000-0000-0000-0000-000000000005' and agent_id='e9150000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.channel_show_card(current_setting('test.ads')::bigint,'run-ads','call-ads-hand','hand','Publish the launch',
 '{"app":"WordPress","line":"The draft is ready","rows":[]}'::jsonb)->>'state','shown','a Run of an Agent some writer cannot see hands a step over');
reset role;
select set_config('test.hiddenhand',(select id::text from public.reply_cards where channel_message_id=current_setting('test.ads')::bigint and kind='hand'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.mark_channel_hand_done('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',
 current_setting('test.hiddenhand')::bigint)->>'first','true','a Member who does not see the Agent presses Done it');
reset role;
select is((select state from public.reply_cards where id=current_setting('test.hiddenhand')::bigint),'done','the step is still recorded as done');
select is((select count(*)::int from public.channel_messages where hand_card=current_setting('test.hiddenhand')::bigint),0,'and no quiet message asks the Agent to pick up');
select is((select count(*)::int from public.channel_runs where message_id=current_setting('test.ads')::bigint),1,'nor starts a Run of an Agent they may not call');

select * from finish();
rollback;
