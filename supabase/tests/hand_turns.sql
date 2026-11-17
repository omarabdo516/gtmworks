begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
-- #140. Writer in RS Learning, shown to the Manager (2), the Contributors (3, 5) and the Viewer (4); the Owner (1) sees
-- every Agent. One Conversation with Writer each, the message of one run in it, and in each but the Viewer's a step
-- Writer handed over in that run.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('fb000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','hand-turn-test','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('fb000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-000000000001','Writer','Articles');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'fb000000-0000-0000-0000-000000000002' from generate_series(2,5) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('fc000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'fb000000-0000-0000-0000-000000000002','Writer' from generate_series(1,5) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('fc000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone','Get the article out',gen_random_uuid(),'turn-run-'||n from generate_series(1,5) n;
set local role service_role;
select results_eq($$select n,public.agent_show_card(('fc000000-0000-0000-0000-00000000000'||n)::uuid,'turn-run-'||n,'call-0','hand','Publish @مدير''s article',
  '{"app":"WordPress","line":"The draft is ready","rows":[]}')->>'state' from generate_series(1,5) n order by n$$,
 $$values (1,'shown'),(2,'shown'),(3,'shown'),(4,'refused'),(5,'shown')$$,'Writer hands a step to the Owner, the Manager and both Contributors, and none to the Viewer');
reset role;
select set_config('test.card',(select id::text from public.reply_cards where conversation_id='fc000000-0000-0000-0000-000000000003'),true);

-- What each person's "Waiting on you" holds of handed steps.
create temporary table seen(step text, n int, hands text);
grant insert on seen to authenticated;
create function pg_temp.look(step text) returns void language plpgsql as $$
begin
 for n in 1..5 loop
  perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-00000000000'||n,true);
  insert into seen select step,n,string_agg(w.id||':'||w.title||':'||w.asked_by||':'||w.conversation_id,',' order by w.id)
   from public.waiting_list('10000000-0000-0000-0000-000000000001') w where w.kind='hand';
 end loop;
end $$;
grant execute on function pg_temp.look(text) to authenticated;
set local role authenticated;
select pg_temp.look('handed');
reset role;
select results_eq($$select n,hands from seen where step='handed' order by n$$,
 $$select n,case when n=4 then null else (select id from public.reply_cards where conversation_id=('fc000000-0000-0000-0000-00000000000'||n)::uuid)||':Publish @مدير''s article:Writer:fc000000-0000-0000-0000-00000000000'||n end
  from generate_series(1,5) n$$,
 'each handed step is one item, titled with the step and named for its Agent, in its own person''s list only: the Owner, the Manager and another Contributor get none of another''s, and the Viewer none');

-- A message written in the Conversation leaves the item where it is.
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values ('10000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000003','مراجع','I will do it after lunch',gen_random_uuid(),'turn-run-3b');
set local role authenticated;
select pg_temp.look('written');
reset role;
select is((select hands from seen where step='written' and n=3),(select hands from seen where step='handed' and n=3),'a message written meanwhile leaves the item in the list');

-- "Done it": the item goes, and one turn of the person's waits behind the open run, telling the Agent who did which
-- step and when. A second press queues nothing.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.mark_hand_done('10000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint)->>'first','true','the Contributor presses Done it');
select pg_temp.look('done');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.mark_hand_done('10000000-0000-0000-0000-000000000001','fc000000-0000-0000-0000-000000000003',current_setting('test.card')::bigint)->>'first','false','and again, from a second tab');
reset role;
select results_eq($$select n,hands from seen where step='done' order by n$$,$$select n,hands from seen where step='handed' and n<>3 union all select 3,null order by 1$$,
 'Done it takes that item out of its person''s list and leaves every other');
select results_eq($$select conversation_id,company_id,person_id,agent_id,message,hand_card,started_at,failed_at from public.conversation_queued_turns$$,
 $$select 'fc000000-0000-0000-0000-000000000003'::uuid,'10000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000003'::uuid,'fb000000-0000-0000-0000-000000000002'::uuid,
  format('مراجع did the step you handed over, "Publish @مدير''s article" in WordPress, and pressed "Done it" at %s UTC. Pick up from there.',to_char(done_at at time zone 'UTC','YYYY-MM-DD HH24:MI')),
  id,null::timestamptz,null::timestamptz from public.reply_cards where id=current_setting('test.card')::bigint$$,
 'one turn waits, the person''s own, naming the card and telling the Agent who did the step, which one and when; the second press queued nothing');
select is((select count(*)::int from public.conversation_notes where conversation_id='fc000000-0000-0000-0000-000000000003'),0,'a title naming a Member makes no note');
select throws_ok($$insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message,hand_card)
  values ('fc000000-0000-0000-0000-000000000003',gen_random_uuid(),'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','fb000000-0000-0000-0000-000000000002','Again',current_setting('test.card')::bigint)$$,
 '23505',null,'a card picks up through one turn at most');

-- The turn is the person's like any other: it starts once the open run ends, reserved for them, and a start whose outcome
-- is unknown is claimed again with the same send key as a retry.
select set_config('test.key',(select send_key::text from public.conversation_queued_turns),true);
set local role service_role;
select is((select count(*)::int from public.claim_conversation_turn('fc000000-0000-0000-0000-000000000003')),0,'it does not start while the run is open');
select is(public.close_conversation_run('fc000000-0000-0000-0000-000000000003','turn-run-3','completed','Here is the draft','session_3',10,2)
 and public.close_conversation_run('fc000000-0000-0000-0000-000000000003','turn-run-3b','completed','Fine','session_3',10,2),true,'the runs end');
select results_eq($$select person,send_key,connection,retry from public.claim_conversation_turn('fc000000-0000-0000-0000-000000000003')$$,
 $$values ('20000000-0000-0000-0000-000000000003'::uuid,current_setting('test.key')::uuid,'fb000000-0000-0000-0000-000000000001'::uuid,false)$$,'then it is claimed for its person on the Agent''s Connection');
reset role;
select is((select person_id::text||':'||message from public.conversation_run_reservations where conversation_id='fc000000-0000-0000-0000-000000000003' and send_key=current_setting('test.key')::uuid and abandoned_at is null),
 '20000000-0000-0000-0000-000000000003:'||(select message from public.conversation_queued_turns),'and its run is reserved for that person with that message');
set local role service_role;
select is(public.begin_start('fc000000-0000-0000-0000-000000000003',current_setting('test.key')::uuid),1,'its first start begins');
select is(public.keep_unknown_start('fc000000-0000-0000-0000-000000000003',current_setting('test.key')::uuid),true,'the Engine''s answer is unknown');
select results_eq($$select send_key,retry from public.claim_conversation_turn('fc000000-0000-0000-0000-000000000003')$$,
 $$values (current_setting('test.key')::uuid,true)$$,'the same turn is claimed again, as a retry with the same send key');
select is(public.record_conversation_turn('fc000000-0000-0000-0000-000000000003',current_setting('test.key')::uuid,'turn-run-3c','fb000000-0000-0000-0000-000000000001'),true,'its run is recorded');
reset role;
select is((select hand_card from public.conversation_messages where conversation_id='fc000000-0000-0000-0000-000000000003' and send_key=current_setting('test.key')::uuid),
 current_setting('test.card')::bigint,'the person''s message it became names its card, so every reader of the messages tells it apart');
select is((select count(*)::int from public.conversation_messages where conversation_id='fc000000-0000-0000-0000-000000000003' and author='person' and hand_card is null),2,
 'the messages the person typed name no card');
select throws_ok($$insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message,hand_card)
  values ('fc000000-0000-0000-0000-000000000002',gen_random_uuid(),'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','fb000000-0000-0000-0000-000000000002','Elsewhere',(select id from public.reply_cards where conversation_id='fc000000-0000-0000-0000-000000000001'))$$,
 '23503',null,'a turn names only a card of its own Conversation');

-- Only its person, an Owner or a Manager stops that run.
create temporary table stops(n int, run text, refused text);
grant insert on stops to authenticated;
create function pg_temp.stop(n int) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-00000000000'||n,true);
 begin
  insert into stops select n,(select run from public.conversation_stop_target('fc000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001')),null;
 exception when others then insert into stops values (n,null,sqlstate);
 end;
end $$;
grant execute on function pg_temp.stop(int) to authenticated;
set local role authenticated;
select pg_temp.stop(n) from generate_series(1,5) n;
reset role;
select results_eq($$select n,run,refused from stops order by n$$,
 $$values (1,'turn-run-3c',null::text),(2,'turn-run-3c',null),(3,'turn-run-3c',null),(4,null,'42501'),(5,null,'42501')$$,
 'its person, the Owner and the Manager may stop it; another Contributor and the Viewer are refused');

-- A Contributor made a Viewer no longer has their handed step waiting.
update public.members set role='viewer' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select pg_temp.look('viewer');
reset role;
select is((select hands from seen where step='viewer' and n=5),null,'a person made a Viewer has no handed step waiting');

select * from finish();
rollback;
