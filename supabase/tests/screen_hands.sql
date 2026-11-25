-- #714: a step an Agent stopped at on its own Screen is a hand card that keeps "on my screen" (`screen` true, nothing
-- else). The Conversation's person alone finds it open on the Agent's Screen (screen_hands); another Member who sees the
-- Agent, a Viewer and another Company's Member find nothing. "Done it" from the view and from the chat card are the one
-- mark_hand_done: two presses change one record, write one log row and queue one turn, and the step then leaves the Screen.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000714','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000714','Ads','Ads',false,'ag-ads-714');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e1000000-0000-0000-0000-000000000714' from generate_series(2,4) n;
-- The Owner's and the Contributor's Conversations with Ads, each with one run.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('e9000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e1000000-0000-0000-0000-000000000714','Ads' from unnest(array[1,3]) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('e9000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone','Set up the campaign',gen_random_uuid(),'screen-run-'||n from unnest(array[1,3]) n;

set local role service_role;
select is(public.agent_show_card('e9000000-0000-0000-0000-000000000001','screen-run-1','call-0','hand','Publish the campaign','{"app":"Meta Ads","line":"Ready in Ads Manager","rows":[],"screen":true}')->>'state','shown',
 'a hand card on the Agent''s Screen is shown');
select is(public.agent_show_card('e9000000-0000-0000-0000-000000000001','screen-run-1','call-1','hand','Pay','{"app":"Stripe","line":"Ready","rows":[],"url":"https://example.com/draft","note":"Next","screen":true}')->>'state','shown',
 'with an address and a note too');
select results_eq($$select x.n,public.agent_show_card('e9000000-0000-0000-0000-000000000001','screen-run-1','call-'||(x.n+10),'hand','Publish',x.content::jsonb)->>'state' from (values
  (1,'{"app":"Meta Ads","line":"Ready","rows":[],"screen":false}'),
  (2,'{"app":"Meta Ads","line":"Ready","rows":[],"screen":"true"}'),
  (3,'{"app":"Meta Ads","line":"Ready","rows":[],"screen":null}')) x(n,content) order by x.n$$,
 $$select n,'invalid' from generate_series(1,3) n$$,'"on my screen" is only ever true');
select is(public.agent_show_card('e9000000-0000-0000-0000-000000000003','screen-run-3','call-0','hand','Publish the post','{"app":"Meta Ads","line":"Ready","rows":[],"screen":true}')->>'state','shown',
 'the Contributor''s Conversation hands one too');
reset role;
-- A step off the Screen is no step on it.
update public.reply_cards set content=content-'screen' where conversation_id='e9000000-0000-0000-0000-000000000001' and call_id='call-1';

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select results_eq($$select conversation,agent,agent_name,title,app from public.screen_hands('10000000-0000-0000-0000-000000000001')$$,
 $$values ('e9000000-0000-0000-0000-000000000001'::uuid,'e1000000-0000-0000-0000-000000000714'::uuid,'Ads','Publish the campaign','Meta Ads')$$,
 'the Owner finds the step of their own Conversation on the Agent''s Screen, and no other Member''s');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select title from public.screen_hands('10000000-0000-0000-0000-000000000001')$$,$$values ('Publish the post')$$,'the Contributor finds only theirs');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is_empty($$select * from public.screen_hands('10000000-0000-0000-0000-000000000001')$$,'a Viewer who sees the Agent finds none');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is_empty($$select * from public.screen_hands('10000000-0000-0000-0000-000000000001')$$,'nor a Member of another Company');

-- "Done it" in the view, then on the chat card: one record, one log row, one turn.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select set_config('test.card',(select id::text from public.reply_cards where conversation_id='e9000000-0000-0000-0000-000000000001' and call_id='call-0'),true);
select is(public.mark_hand_done('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint)->>'first','true','the first press records it');
select is(public.mark_hand_done('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint)->>'first','false','the second answers that record');
select is_empty($$select * from public.screen_hands('10000000-0000-0000-0000-000000000001')$$,'the step done leaves the Screen');
reset role;
select results_eq($$select (select count(*)::int from public.reply_cards where id=current_setting('test.card')::bigint and state='done' and done_by='20000000-0000-0000-0000-000000000001'),
  (select count(*)::int from public.company_log where action='agent_hand_done' and source='reply_card_answers' and source_id=current_setting('test.card')::bigint),
  (select count(*)::int from public.conversation_queued_turns where hand_card=current_setting('test.card')::bigint)$$,
 $$values (1,1,1)$$,'two presses are one record, one log row and one turn');
select * from finish();
rollback;
