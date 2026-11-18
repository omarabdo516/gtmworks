begin;
create extension if not exists pgtap with schema extensions;
select plan(25);
-- #165. Ads in RS Learning, shown to the Manager (2), the Contributors (3, 5) and the Viewer (4); the Owner (1) sees every
-- Agent. Each of them has one Conversation with Ads, and in it the message of one Run that asks to be allowed an action.
-- Contributor 3's chat has a Card on the board. Karim is a Manager of Aleem only. In the general channel Contributor 3
-- calls Ads, and its Run asks too.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values
 ('e1650000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e1650000-0000-0000-0000-000000000001','Ads','Ads','permission-waits-test');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e1650000-0000-0000-0000-000000000002' from generate_series(2,5) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('e2650000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001'::uuid,('20000000-0000-0000-0000-00000000000'||n)::uuid,'e1650000-0000-0000-0000-000000000002'::uuid,'Ads' from generate_series(1,5) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('e2650000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone','Clean up the exports',gen_random_uuid(),'w-run-'||n from generate_series(1,5) n;
insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id)
 select company_id,id,'Clean up the exports','e1650000-0000-0000-0000-000000000002','e2650000-0000-0000-0000-000000000003' from public.work_stages
 where company_id='10000000-0000-0000-0000-000000000001' and board_column='progress' and kind='before_review' order by position,id limit 1;
insert into auth.users(id,email) values ('e3650000-0000-0000-0000-000000000001','karim.waits@example.test');
insert into public.people(id,name) values ('e3650000-0000-0000-0000-000000000001','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','e3650000-0000-0000-0000-000000000001','manager');
select set_config('test.asking','{"id":"a1","description":"delete the old exports","command":"rm -r exports","choices":["once","deny"]}',true);

-- What each person's "Waiting on you" holds of permission requests, and how many channel requests each one reads.
create temporary table waits(who int, kind text, id bigint, title text, asked_by text, card_id bigint, conversation_id uuid);
create temporary table readable(who int, n int);
grant all on waits, readable to authenticated;
create function pg_temp.read_waits(who int, person uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',person::text,true);
 insert into waits select who,w.kind,w.id,w.title,w.asked_by,w.card_id,w.conversation_id from public.waiting_list('10000000-0000-0000-0000-000000000001') w where w.kind in ('permission','channel_permission');
 insert into waits select who,w.kind,w.id,w.title,w.asked_by,w.card_id,w.conversation_id from public.waiting_list('10000000-0000-0000-0000-000000000003') w where w.kind in ('permission','channel_permission');
 insert into readable select who,count(*)::int from public.channel_permissions;
end $$;
grant execute on function pg_temp.read_waits(int,uuid) to authenticated;
create function pg_temp.read_all() returns void language plpgsql as $$
begin
 delete from waits; delete from readable;
 perform pg_temp.read_waits(n,('20000000-0000-0000-0000-00000000000'||n)::uuid) from generate_series(1,5) n;
 perform pg_temp.read_waits(6,'e3650000-0000-0000-0000-000000000001');
end $$;
grant execute on function pg_temp.read_all() to authenticated;

set local role service_role;
select public.track_run_permission(('e2650000-0000-0000-0000-00000000000'||n)::uuid,'w-run-'||n,current_setting('test.asking')::jsonb,false,'2026-06-10T10:14:00Z') from generate_series(1,5) n;
reset role;
select set_config('test.card'||n,(select id::text from public.reply_cards where conversation_id=('e2650000-0000-0000-0000-00000000000'||n)::uuid and kind='permission'),true) from generate_series(1,5) n;
select set_config('test.board',(select id::text from public.work_cards where conversation_id='e2650000-0000-0000-0000-000000000003'),true);

-- A pending request is one item for the Conversation's own person, with the Agent and what it asks; a Viewer, who
-- cannot decide, has none, and nobody sees another's private Conversation.
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select pg_temp.read_all();
reset role;
select results_eq($$select who,kind,id,title,asked_by,card_id,conversation_id from waits order by who$$,
 $$select n,'permission'::text,current_setting('test.card'||n)::bigint,'delete the old exports'::text,'Ads'::text,
   case when n=3 then current_setting('test.board')::bigint end,('e2650000-0000-0000-0000-00000000000'||n)::uuid from unnest(array[1,2,3,5]) n$$,
 'each person who can decide has their own request, named by the Agent and what it asks, its chat''s Card with it');

-- The chat's Card waits on its person, as a question or a handed step does (#146), so the board draws it under
-- "Waiting on you", and every reader of the Card reads that wait.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select public.card_wait(w) from public.work_cards w where w.id=current_setting('test.board')::bigint),
 jsonb_build_object('person','20000000-0000-0000-0000-000000000003','kind','permission','title','delete the old exports'),'the chat''s Card reads the request it waits on');
reset role;

-- A Member who can no longer see the Agent has no item and no count for its request.
delete from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000005' and agent_id='e1650000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.read_all();
reset role;
select is((select count(*)::int from waits where who=5),0,'a Member the Agent is hidden from has no item for its request');
select is((select count(*)::int from waits where who=6),0,'and a Member of another Company has none, in either Company');
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','e1650000-0000-0000-0000-000000000002');

-- Each ending takes the item away: allowed (3), refused (2), the Engine stopped waiting (1), the Run ended (5).
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select public.decide_permission('10000000-0000-0000-0000-000000000001','e2650000-0000-0000-0000-000000000003',current_setting('test.card3')::bigint,'once');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.decide_permission('10000000-0000-0000-0000-000000000001','e2650000-0000-0000-0000-000000000002',current_setting('test.card2')::bigint,'deny');
reset role;
set local role service_role;
select public.track_run_permission('e2650000-0000-0000-0000-000000000001','w-run-1',null,false,'2026-06-10T10:16:00Z');
reset role;
insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
 values ('10000000-0000-0000-0000-000000000001','e2650000-0000-0000-0000-000000000005','w-run-5','completed');
set local role authenticated;
select pg_temp.read_all();
reset role;
select is((select count(*)::int from waits),0,'a request allowed, refused, closed by the Engine or ended with its Run leaves the list');
select is((select public.card_wait(w) from public.work_cards w where w.id=current_setting('test.board')::bigint),null,'and its Card waits no more');

-- A later read of a Run still waiting on the same request never brings it back.
set local role service_role;
select public.track_run_permission('e2650000-0000-0000-0000-000000000001','w-run-1',current_setting('test.asking')::jsonb,false,'2026-06-10T10:17:00Z');
select public.settle_permission(current_setting('test.card3')::bigint,'decided');
reset role;
set local role authenticated;
select pg_temp.read_all();
reset role;
select is((select count(*)::int from waits),0,'the Engine showing the same request again, or the choice settling, brings no item back');
select is((select count(*)::int from public.reply_cards where conversation_id='e2650000-0000-0000-0000-000000000001' and kind='permission'),1,'and keeps no second card for it');

-- In the general channel: Contributor 3 calls Ads, and its Run asks.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select set_config('test.called',public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Ads clean up the exports')::text,true);
select set_config('test.other',public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Ads clean up the backups')::text,true);
reset role;
update public.channel_runs set attempts=1,attempted_at=now(),run_id='c-run-'||message_id where message_id in (current_setting('test.called')::bigint,current_setting('test.other')::bigint);
set local role service_role;
select is(public.track_channel_permission(current_setting('test.called')::bigint,'c-run-'||current_setting('test.called'),current_setting('test.asking')::jsonb,false,'2026-06-10T10:14:00Z'),'[]'::jsonb,
 'the closer keeps the request a channel''s Run waits on, with nothing yet to deliver');
select public.track_channel_permission(current_setting('test.other')::bigint,'c-run-'||current_setting('test.other'),'{"id":"b1","description":"delete the old backups","command":"rm -r backups","choices":["once","always","deny"]}',false,'2026-06-10T10:14:00Z');
select is(public.track_channel_permission(current_setting('test.called')::bigint,'c-run-x',current_setting('test.asking')::jsonb,false,'2026-06-10T10:14:00Z'),'[]'::jsonb,'nor a Run that is not the message''s');
reset role;
select results_eq($$select title,state,content from public.channel_permissions order by id$$,
 $$values ('delete the old exports','open','{"description":"delete the old exports","command":"rm -r exports","choices":["once","deny"]}'::jsonb),
  ('delete the old backups','open','{"description":"delete the old backups","command":"rm -r backups","choices":["once","deny"]}'::jsonb)$$,
 'one open request per Run that asked; always is not kept, since the Run is not on the Agent''s own profile');
select set_config('test.ch1',(select id::text from public.channel_permissions where request_id='a1'),true);
select set_config('test.ch2',(select id::text from public.channel_permissions where request_id='b1'),true);

set local role authenticated;
select pg_temp.read_all();
reset role;
select results_eq($$select who,kind,id,title,asked_by,card_id,conversation_id from waits order by who,id$$,
 $$values (3,'channel_permission'::text,current_setting('test.ch1')::bigint,'delete the old exports'::text,'Ads'::text,null::bigint,null::uuid),
  (3,'channel_permission',current_setting('test.ch2')::bigint,'delete the old backups','Ads',null,null)$$,
 'only the Member who called the Agent has the channel''s requests in their list');
select results_eq($$select who,n from readable order by who$$,$$values (1,2),(2,2),(3,2),(4,2),(5,2),(6,0)$$,
 'every Member in the channel reads them, and nobody outside the Company does');

-- Only the Member who called the Agent decides; "Always allow" follows #163's Roles.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.decide_channel_permission('10000000-0000-0000-0000-000000000001',current_setting('test.ch1')::bigint,'once')$$,
 '42501','channelNotAllowed','another Member of the channel, even a Manager, cannot decide');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.decide_channel_permission('10000000-0000-0000-0000-000000000001',current_setting('test.ch1')::bigint,'once')$$,
 '42501','channelNotAllowed','nor a Viewer');
select set_config('request.jwt.claim.sub','e3650000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.decide_channel_permission('10000000-0000-0000-0000-000000000003',current_setting('test.ch1')::bigint,'once')$$,
 'P0002','channelNotFound','nor a Member of another Company');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.decide_channel_permission('10000000-0000-0000-0000-000000000001',current_setting('test.ch1')::bigint,'always')$$,
 '22023','permissionChoiceInvalid','the caller cannot send a choice the request does not offer');
select is(public.decide_channel_permission('10000000-0000-0000-0000-000000000001',current_setting('test.ch1')::bigint,'once')-'at',
 '{"state":"decided","choice":"once","first":true}'::jsonb,'the Member who called the Agent allows it once');
select is(public.decide_channel_permission('10000000-0000-0000-0000-000000000001',current_setting('test.ch1')::bigint,'deny')-'at',
 '{"state":"decided","choice":"once","first":false}'::jsonb,'a second press changes nothing');
reset role;

-- The closer delivers the claim; the other request ends with its Run; neither comes back.
set local role service_role;
select is(public.track_channel_permission(current_setting('test.called')::bigint,'c-run-'||current_setting('test.called'),current_setting('test.asking')::jsonb,false,'2026-06-10T10:18:00Z'),
 jsonb_build_array(jsonb_build_object('card',current_setting('test.ch1')::bigint,'permission','a1','choice','once')),'the closer is handed the claim to deliver');
-- One closer at a time (the press's own delivery, the channel's read, the worker), as in a Conversation.
select is(public.track_channel_permission(current_setting('test.called')::bigint,'c-run-'||current_setting('test.called'),current_setting('test.asking')::jsonb,false,'2026-06-10T10:18:00Z'),
 '[]'::jsonb,'a second closer is not handed the claim another closer is delivering');
reset role;
update public.channel_permissions set delivering_at=now()-interval '16 seconds' where id=current_setting('test.ch1')::bigint;
set local role service_role;
select is(public.track_channel_permission(current_setting('test.called')::bigint,'c-run-'||current_setting('test.called'),current_setting('test.asking')::jsonb,false,'2026-06-10T10:18:00Z'),
 jsonb_build_array(jsonb_build_object('card',current_setting('test.ch1')::bigint,'permission','a1','choice','once')),'a claim whose closer went quiet is handed over again');
select public.settle_channel_permission(current_setting('test.ch1')::bigint,'decided');
select public.close_channel_run(current_setting('test.other')::bigint,'c-run-'||current_setting('test.other'),'stopped',null,null,null);
reset role;
select results_eq($$select state from public.channel_permissions order by id$$,$$values ('decided'),('closed')$$,'the delivered request reads decided, and the Run''s end closes the other');
set local role authenticated;
select pg_temp.read_all();
reset role;
select is((select count(*)::int from waits),0,'and neither waits on anyone');
select is((select details from public.company_log where action='agent_permission_decided' and source='channel_permissions'),
 '{"permission":{"text":"delete the old exports","choice":"once"},"private":true,"teller":"20000000-0000-0000-0000-000000000003"}'::jsonb,'the decision the Engine took is logged once, privately');

select * from finish();
rollback;
