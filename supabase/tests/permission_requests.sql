begin;
create extension if not exists pgtap with schema extensions;
select plan(41);
-- #163. Ads in RS Learning on its own profile in the Engine (ADR 0016), shown to the Manager (2), the Contributors (3, 5)
-- and the Viewer (4); the Owner (1) sees every Agent. One Conversation with Ads each, and in it the message of one Run.
-- Copy sits on a profile it shares, in one Conversation of the Owner's (6). Karim is a Manager of Aleem only.
insert into public.agent_profiles(agent_id,company_id) values ('e1000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('e1000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','permissions-test','ciphertext','connected','0.23.0','{run_submission}'),
 ('e1000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','ag-e1000000000000000000000000000002','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values
 ('e1000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000004','Ads','Ads'),
 ('e1000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','Copy','Copy');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e1000000-0000-0000-0000-000000000002' from generate_series(2,5) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('e2000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001'::uuid,('20000000-0000-0000-0000-00000000000'||n)::uuid,'e1000000-0000-0000-0000-000000000002'::uuid,'Ads' from generate_series(1,5) n
 union all select 'e2000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003','Copy';
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('e2000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||case when n=6 then 1 else n end)::uuid,'Someone','Clean up the exports',gen_random_uuid(),'p-run-'||n from generate_series(1,6) n;
insert into auth.users(id,email) values ('e3000000-0000-0000-0000-000000000001','karim@example.test');
insert into public.people(id,name) values ('e3000000-0000-0000-0000-000000000001','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','e3000000-0000-0000-0000-000000000001','manager');
select set_config('test.asking','{"id":"a1","description":"delete the old exports","command":"rm -r exports","choices":["once","always","deny"]}',true);

-- The closer keeps the request its read shows, once, in the Conversation of the Run that waits on it.
set local role service_role;
select results_eq($$select public.track_run_permission(('e2000000-0000-0000-0000-00000000000'||n)::uuid,'p-run-'||n,current_setting('test.asking')::jsonb,false,'2026-06-10T10:14:00Z',
  run_profile=>case when n<6 then 'ag-e1000000000000000000000000000002' else 'permissions-test' end) from generate_series(1,6) n$$,
 $$select '[]'::jsonb from generate_series(1,6)$$,'a request each Run waits on is kept, with nothing yet to deliver');
select results_eq($$values (public.track_run_permission('e2000000-0000-0000-0000-000000000003','p-run-3',current_setting('test.asking')::jsonb,false,'2026-06-10T10:15:00Z')),
  (public.track_run_permission('e2000000-0000-0000-0000-000000000003','p-run-9',current_setting('test.asking')::jsonb,false,'2026-06-10T10:15:00Z')),
  (public.track_run_permission('e2000000-0000-0000-0000-000000000001','p-run-1','{"id":"a9","description":" ","command":"","choices":["once","deny"]}',false,'2026-06-10T10:14:00Z')),
  (public.track_run_permission('e2000000-0000-0000-0000-000000000001','p-run-1','{"id":"a8","description":"delete","command":"rm","choices":["once","session","deny"]}',false,'2026-06-10T10:14:00Z'))$$,
 $$values ('[]'::jsonb),('[]'::jsonb),('[]'::jsonb),('[]'::jsonb)$$,'the next read keeps nothing more, nor does a Run not in the Conversation, a request with no words or a choice the card cannot hold');
reset role;
select results_eq($$select conversation_id,run_id,call_id,title,state,content from public.reply_cards where kind='permission' order by conversation_id$$,
 $$select ('e2000000-0000-0000-0000-00000000000'||n)::uuid,'p-run-'||n,'a1','delete the old exports','open',
  case when n<6 then '{"description":"delete the old exports","command":"rm -r exports","choices":["once","always","deny"]}'::jsonb
   else '{"description":"delete the old exports","command":"rm -r exports","choices":["once","deny"]}'::jsonb end from generate_series(1,6) n$$,
 'one open card per Run that asked, its title the description; on a shared profile always is not kept, since the Engine would widen every Agent there');
set local role service_role;
select public.track_run_permission('e2000000-0000-0000-0000-000000000006','p-run-6','{"id":"a2","description":"","command":"curl -X POST https://example.com/hooks","choices":["once","deny"]}',false,'2026-06-10T10:14:00Z');
reset role;
select is((select title from public.reply_cards where call_id='a2'),'curl -X POST https://example.com/hooks','a request with no description is titled with its command');

-- Who may send what: always only for an Owner or a Manager, nothing for a Viewer or anyone outside the Company.
create temporary table offered(n int, may text[]);
grant insert on offered to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into offered values (1,public.permission_choices('10000000-0000-0000-0000-000000000001'));
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into offered values (2,public.permission_choices('10000000-0000-0000-0000-000000000001'));
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into offered values (3,public.permission_choices('10000000-0000-0000-0000-000000000001'));
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into offered values (4,public.permission_choices('10000000-0000-0000-0000-000000000001'));
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into offered values (5,public.permission_choices('10000000-0000-0000-0000-000000000001'));
set local role authenticated;
select set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000001',true);
insert into offered values (6,public.permission_choices('10000000-0000-0000-0000-000000000001'));
reset role;
select results_eq($$select n,may from offered order by n$$,
 $$values (1,array['once','always','deny']),(2,array['once','always','deny']),(3,array['once','deny']),(4,'{}'::text[]),(5,array['once','deny']),(6,'{}'::text[])$$,
 'the Owner and the Manager may send all three, a Contributor once and deny, the Viewer and another Company''s Manager nothing');

-- Only the Conversation's own person decides, never a Viewer, an Agent or anyone from another Company.
select set_config('test.card'||n,(select id::text from public.reply_cards where conversation_id=('e2000000-0000-0000-0000-00000000000'||n)::uuid and call_id='a1'),true) from generate_series(1,6) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000003',current_setting('test.card3')::bigint,'once')$$,
 'P0002','conversationNotFound','another Member cannot decide the request');
select throws_ok($$select public.decide_permission('10000000-0000-0000-0000-000000000003','e2000000-0000-0000-0000-000000000005',current_setting('test.card5')::bigint,'once')$$,
 'P0002','conversationNotFound','a person naming another Company they belong to cannot decide in their own Conversation of this Company');
select set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000003',current_setting('test.card3')::bigint,'once')$$,
 '42501','conversationNotAllowed','another Company''s Manager cannot decide in this Company');
select throws_ok($$select public.decide_permission('10000000-0000-0000-0000-000000000003','e2000000-0000-0000-0000-000000000003',current_setting('test.card3')::bigint,'once')$$,
 'P0002','conversationNotFound','nor through their own Company');
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',current_setting('test.card1')::bigint,'once')$$,
 'P0002','conversationNotFound','an Agent''s own identity cannot decide a person''s request');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000004',current_setting('test.card4')::bigint,'once')$$,
 '42501','conversationNotAllowed','a Viewer cannot decide, even a request of their own Conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000003',current_setting('test.card3')::bigint,'always')$$,
 '42501','conversationNotAllowed','a Contributor cannot always allow');
select throws_ok($$select public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000003',current_setting('test.card3')::bigint,'session')$$,
 '22023','permissionChoiceInvalid','a choice the Engine did not offer is refused');
select results_eq($$select x->>'state',x->>'choice',(x->>'first')::boolean,(x->>'at') is not null from (select public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000003',current_setting('test.card3')::bigint,'once') x) d$$,
 $$values ('decided','once',true,true)$$,'a Contributor allows once in their own Conversation, and is told the press was the first');
select results_eq($$select x->>'state',x->>'choice',(x->>'first')::boolean from (values
  (public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000003',current_setting('test.card3')::bigint,'deny')),
  (public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000003',current_setting('test.card3')::bigint,'once'))) v(x)$$,
 $$values ('decided','once',false),('decided','once',false)$$,'a second press, of another choice or the same one, keeps the first choice and says so');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002',current_setting('test.card2')::bigint,'always')->>'choice','always',
 'a Manager always allows in their own Conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',current_setting('test.card1')::bigint,'deny')->>'choice','deny',
 'the Owner does not allow in their own Conversation');
select throws_ok($$select public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000006',current_setting('test.card6')::bigint,'always')$$,
 '22023','permissionChoiceInvalid','on a shared profile not even the Owner can always allow');
reset role;
select results_eq($$select conversation_id,state,content->>'choice',decided_by from public.reply_cards where decided_at is not null order by conversation_id$$,
 $$values ('e2000000-0000-0000-0000-000000000001'::uuid,'sending','deny','20000000-0000-0000-0000-000000000001'::uuid),
  ('e2000000-0000-0000-0000-000000000002'::uuid,'sending','always','20000000-0000-0000-0000-000000000002'::uuid),
  ('e2000000-0000-0000-0000-000000000003'::uuid,'sending','once','20000000-0000-0000-0000-000000000003'::uuid)$$,
 'each claim keeps its choice and who decided');

-- The closer delivers each claim; a delivery the Engine took is logged once, and a closed verdict never undoes it.
set local role service_role;
select is(public.track_run_permission('e2000000-0000-0000-0000-000000000003','p-run-3',current_setting('test.asking')::jsonb,false,'2026-06-10T10:16:00Z'),
 jsonb_build_array(jsonb_build_object('card',current_setting('test.card3')::bigint,'permission','a1','choice','once')),'the next read hands over the claim to deliver');
-- One closer at a time (the press's own delivery, the page's read, the worker): a read while the claim is handed over gets
-- nothing, and one after its 15 seconds gets it again, as a closer that died would.
select is(public.track_run_permission('e2000000-0000-0000-0000-000000000003','p-run-3',current_setting('test.asking')::jsonb,false,'2026-06-10T10:16:00Z'),
 '[]'::jsonb,'a second closer is not handed the claim another closer is delivering');
reset role;
update public.reply_cards set delivering_at=now()-interval '16 seconds' where id=current_setting('test.card3')::bigint;
set local role service_role;
select is(public.track_run_permission('e2000000-0000-0000-0000-000000000003','p-run-3',current_setting('test.asking')::jsonb,false,'2026-06-10T10:16:00Z'),
 jsonb_build_array(jsonb_build_object('card',current_setting('test.card3')::bigint,'permission','a1','choice','once')),'a claim whose closer went quiet is handed over again');
select results_eq($$values (public.settle_permission(current_setting('test.card3')::bigint,'decided')),(public.settle_permission(current_setting('test.card3')::bigint,'closed')),
  (public.settle_permission(current_setting('test.card2')::bigint,'closed'))$$,
 $$values ('decided'),('decided'),('closed')$$,'the Engine took one choice, and a later verdict does not change it; the other was no longer waited for and is closed');
select is(public.track_run_permission('e2000000-0000-0000-0000-000000000003','p-run-3',null,false,'2026-06-10T10:17:00Z'),'[]'::jsonb,'nothing is left to deliver once it is settled');
select throws_ok($$select public.settle_permission(current_setting('test.card3')::bigint,'once')$$,'22023','permissionVerdictInvalid','a verdict is decided or closed');
reset role;
select results_eq($$select actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id from public.company_log where action='agent_permission_decided'$$,
 $$select '20000000-0000-0000-0000-000000000003'::uuid,'person',(select name from public.people where id='20000000-0000-0000-0000-000000000003'),'agent','e1000000-0000-0000-0000-000000000002'::uuid,'agent_permission_decided',
  '{"permission":{"text":"delete the old exports","choice":"once"},"private":true,"teller":"20000000-0000-0000-0000-000000000003"}'::jsonb,'reply_card_answers',current_setting('test.card3')::bigint$$,
 'the decision is logged once, privately, as the person who decided, with the Agent, what was asked and the choice');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select x->>'state',x->>'choice',(x->>'at')::timestamptz=(select decided_at from public.reply_cards where id=current_setting('test.card3')::bigint) from (values
  (public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000003',current_setting('test.card3')::bigint,'deny'))) v(x)$$,
 $$values ('decided','once',true)$$,'a press after it was decided answers the choice and the time of the first press');
reset role;
-- A closer that reports the Engine took a choice after all wins over a closed card holding it.
set local role service_role;
select is(public.settle_permission(current_setting('test.card2')::bigint,'decided'),'decided','a delivery the Engine took wins over a closed card holding the same choice');
reset role;

-- The Engine stops waiting (its time limit, a stop, the Run's end): a read that began after the card was kept and no
-- longer shows it closes it, an earlier read does not, and a press then changes nothing.
set local role service_role;
select public.track_run_permission('e2000000-0000-0000-0000-000000000005','p-run-5',null,false,'2026-06-10T10:13:00Z');
reset role;
select is((select state from public.reply_cards where id=current_setting('test.card5')::bigint),'open','a read that began before the request was kept does not close it');
set local role service_role;
select public.track_run_permission('e2000000-0000-0000-0000-000000000005','p-run-5',null,false,'2026-06-10T10:20:00Z');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select results_eq($$select x->>'state',x->>'choice',(x->>'first')::boolean from (values
  (public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000005',current_setting('test.card5')::bigint,'once'))) v(x)$$,
 $$values ('closed',null::text,false)$$,'a later read that no longer shows it closes it, and a press then is told it closed');
reset role;
select is((select state||coalesce(content->>'choice','') from public.reply_cards where id=current_setting('test.card5')::bigint),'closed','and it keeps no choice');

-- A Run's end closes its claimed request with the choice kept, and the Conversation's next Run is asked again.
insert into public.conversation_usage(company_id,conversation_id,run_id,outcome) values ('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','p-run-1','completed');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values ('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Someone','And the backups?',gen_random_uuid(),'p-run-1b');
set local role service_role;
select public.track_run_permission('e2000000-0000-0000-0000-000000000001','p-run-1b','{"id":"a3","description":"delete the old backups","command":"rm -r backups","choices":["once","deny"]}',false,'2026-06-10T10:30:00Z');
reset role;
select results_eq($$select run_id,state,content->>'choice' from public.reply_cards where conversation_id='e2000000-0000-0000-0000-000000000001' and kind='permission' order by id$$,
 $$values ('p-run-1','closed','deny'),('p-run-1b','open',null)$$,'a claimed choice whose Run ended closes with the choice kept, and the next Run''s request is kept');
-- A request left open for a Run that had already ended (recreated here by writing that Run's end with the trigger off)
-- cannot be decided any more, and a later read keeps nothing for that Run.
alter table public.conversation_usage disable trigger conversation_usage_closes_permissions;
insert into public.conversation_usage(company_id,conversation_id,run_id,outcome) values ('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','p-run-1b','completed');
alter table public.conversation_usage enable trigger conversation_usage_closes_permissions;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',(select id from public.reply_cards where call_id='a3'),'once')->>'state','closed',
 'a request whose Run has already ended cannot be decided');
reset role;
set local role service_role;
select is(public.track_run_permission('e2000000-0000-0000-0000-000000000001','p-run-1b','{"id":"a4","description":"delete more","command":"rm -r more","choices":["once","deny"]}',false,'2026-06-10T10:40:00Z'),'[]'::jsonb,
 'a read of an ended Run keeps nothing');
reset role;
select results_eq($$select call_id,state,content ? 'choice' from public.reply_cards where conversation_id='e2000000-0000-0000-0000-000000000001' and run_id='p-run-1b'$$,
 $$values ('a3','closed',false)$$,'the ended Run''s request is closed holding no choice, and nothing new is kept');

-- Who reads the decision's log row: its person, the Owner and the Manager, not another Contributor or the Viewer; and
-- nothing but the database's own functions write a request.
create temporary table seen(n int, logged int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*) from public.company_log where action='agent_permission_decided');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*) from public.company_log where action='agent_permission_decided');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*) from public.company_log where action='agent_permission_decided');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*) from public.company_log where action='agent_permission_decided');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 5,(select count(*) from public.company_log where action='agent_permission_decided');
reset role;
select results_eq($$select * from seen order by n$$,$$values (1,2),(2,2),(3,1),(4,0),(5,0)$$,
 'each decision''s row is read by its person, the Owner and the Manager, and not by another Contributor or the Viewer');
select ok(not has_function_privilege('anon','public.decide_permission(uuid,uuid,bigint,text)','execute')
  and not has_function_privilege('service_role','public.decide_permission(uuid,uuid,bigint,text)','execute')
  and not has_function_privilege('authenticated','public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text)','execute')
  and not has_function_privilege('authenticated','public.settle_permission(bigint,text)','execute')
  and not has_table_privilege('authenticated','public.reply_cards','insert') and not has_table_privilege('authenticated','public.reply_cards','update'),
 'only a signed-in person decides, only the closer tracks and settles, and no one writes a card directly');

-- Two reads overlap: one began first but saw the request only after a later one found nothing yet. The card is kept as of
-- the end of the read that saw it, so the later read, which began before that, does not close it.
set local role service_role;
select public.track_run_permission('e2000000-0000-0000-0000-000000000004','p-run-4','{"id":"a7","description":"archive the exports","command":"tar -cf exports.tar exports","choices":["once","deny"]}',false,'2026-06-10T11:00:00Z','2026-06-10T11:05:00Z');
select public.track_run_permission('e2000000-0000-0000-0000-000000000004','p-run-4',null,false,'2026-06-10T11:02:00Z');
reset role;
select is((select state from public.reply_cards where call_id='a7'),'open','a read that began before the request was seen does not close it, though it began after the read that saw it');

-- A read that finds the Run ended closes its claimed request with the choice kept, and hands over nothing to deliver.
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values ('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000005','person','20000000-0000-0000-0000-000000000005','Someone','And the logs?',gen_random_uuid(),'p-run-5e');
set local role service_role;
select public.track_run_permission('e2000000-0000-0000-0000-000000000005','p-run-5e','{"id":"a5","description":"delete the old logs","command":"rm -r logs","choices":["once","deny"]}',false,'2026-06-10T11:10:00Z');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select public.decide_permission('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000005',(select id from public.reply_cards where call_id='a5'),'once');
reset role;
set local role service_role;
select is(public.track_run_permission('e2000000-0000-0000-0000-000000000005','p-run-5e',null,true,'2026-06-10T11:12:00Z'),'[]'::jsonb,
 'a read that finds the Run ended hands over no claim to deliver');
reset role;
select is((select state||':'||(content->>'choice') from public.reply_cards where call_id='a5'),'closed:once','and closes the claimed request with its choice kept');

-- Always is kept by the profile the Run is read on, not the one its Agent is attached to now: Ads is on its own profile,
-- but a Run still on the shared one, or read on no named profile, is not offered always.
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000002','Someone','And the '||r,gen_random_uuid(),'p-run-2'||r
 from unnest(array['s','o','n']) r;
set local role service_role;
select public.track_run_permission('e2000000-0000-0000-0000-000000000002','p-run-2'||r,jsonb_build_object('id','a6'||r,'description','delete the '||r,'command','rm -r '||r,'choices',array['once','always','deny']),false,'2026-06-10T11:20:00Z',
  run_profile=>case r when 's' then 'permissions-test' when 'o' then 'ag-e1000000000000000000000000000002' end)
 from unnest(array['s','o','n']) r;
reset role;
select results_eq($$select run_id,content->'choices' from public.reply_cards where run_id in ('p-run-2s','p-run-2o','p-run-2n') order by run_id$$,
 $$values ('p-run-2n','["once","deny"]'::jsonb),('p-run-2o','["once","always","deny"]'::jsonb),('p-run-2s','["once","deny"]'::jsonb)$$,
 'a Run on the Agent''s own profile keeps always, one on the shared profile or on none named does not');

select * from finish();
rollback;
