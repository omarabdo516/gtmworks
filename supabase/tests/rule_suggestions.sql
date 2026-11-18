begin;
create extension if not exists pgtap with schema extensions;
select plan(52);
-- #25. Ads in RS Learning, shown to the Manager (2), the Contributors (3, 5) and the Viewer (4); the Owner (1) sees every
-- Agent. One Conversation with Ads each, and in it the whole message of each run that tells a rule.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('e5000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','suggest-test','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('e5000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000001','Ads','Ads');
-- Ads has its own profile in the bundled Engine, whose SOUL.md holds the team's rules (#345).
insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) values ('e5000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',1,public.engine_tool_policy());
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e5000000-0000-0000-0000-000000000002' from generate_series(2,5) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('e6000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e5000000-0000-0000-0000-000000000002','Ads' from generate_series(1,5) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('e6000000-0000-0000-0000-00000000000'||x.n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||x.n)::uuid,'Someone',x.body,gen_random_uuid(),x.run
 from (values (3,'sg-a','From now on, write every Saudi ad in a light Saudi dialect'),(3,'sg-b','From now on, no emojis'),(3,'sg-c','From now on, answer within the hour'),
  (3,'sg-d','From now on, sign every reply'),(4,'sg-v','From now on, no emojis'),(1,'sg-e','From now on, send nothing to a customer before I see it'),
  (2,'sg-f','From now on, keep every ad under 90 characters')) x(n,run,body);
-- Ids are read as the database administrator and kept for the statements that run as a person.
select set_config('test.c','10000000-0000-0000-0000-000000000001',true);

-- A Contributor tells Ads a lasting rule: a suggestion waiting for an OK, sent to the Owner and the Manager.
set local role service_role;
select is(public.agent_save_rule('e6000000-0000-0000-0000-000000000003','sg-a','call-0','From now on, write every Saudi ad in a light Saudi dialect')->>'state','suggested','the Contributor''s rule is kept as a suggestion');
select is(public.agent_save_rule('e6000000-0000-0000-0000-000000000004','sg-v','call-0','From now on, no emojis')->>'state','refused','a Viewer''s is refused');
reset role;
select set_config('test.a',(select id::text from public.agent_rules where run_id='sg-a'),true);
select set_config('test.a1',(select id::text from public.waiting_items where agent_rule_id=current_setting('test.a')::uuid and person_id='20000000-0000-0000-0000-000000000001'),true);
select set_config('test.a2',(select id::text from public.waiting_items where agent_rule_id=current_setting('test.a')::uuid and person_id='20000000-0000-0000-0000-000000000002'),true);
set local role service_role;
select is(public.agent_save_rule('e6000000-0000-0000-0000-000000000003','sg-a','call-0','From now on, write every Saudi ad in a light Saudi dialect'),jsonb_build_object('state','suggested','rule',current_setting('test.a')),
 'closing the run again answers the same suggestion');
reset role;
select results_eq($$select body,said_by,suggestion,decided_by is null from public.agent_rules$$,
 $$values ('From now on, write every Saudi ad in a light Saudi dialect','20000000-0000-0000-0000-000000000003'::uuid,'pending',true)$$,'one rule, said by the Contributor, waiting');
select results_eq($$select person_id,kind,title,body,asked_by,card_id is null and conversation_id is null,resolved_at is null from public.waiting_items where agent_rule_id is not null order by person_id$$,
 $$values ('20000000-0000-0000-0000-000000000001'::uuid,'rule_suggestion','From now on, write every Saudi ad in a light Saudi dialect','Ads','مراجع',true,true),
  ('20000000-0000-0000-0000-000000000002'::uuid,'rule_suggestion','From now on, write every Saudi ad in a light Saudi dialect','Ads','مراجع',true,true)$$,
 'it waits on the Owner and on the Manager, once each');
select results_eq($$select actor_id,action,details->>'rule' from public.company_log where agent_id='e5000000-0000-0000-0000-000000000002'$$,
 $$values ('20000000-0000-0000-0000-000000000003'::uuid,'agent_rule_suggested','From now on, write every Saudi ad in a light Saudi dialect')$$,'and is logged once as suggested');

-- Reach: a suggestion is not one of the team's rules, so it is not in the Agent's SOUL.md (#345).
select is((select rules from public.agent_soul_rules_work() where profile='ag-e5000000000000000000000000000002'),'[]'::jsonb,'it is not one of the team''s rules');
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 select ('e6000000-0000-0000-0000-00000000000'||n)::uuid,('e7000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000001',
  ('20000000-0000-0000-0000-00000000000'||n)::uuid,'e5000000-0000-0000-0000-000000000002','Draft the offer email','suggest-test' from unnest(array[3,5]) n;
select public.pinned_run_note(('e6000000-0000-0000-0000-00000000000'||n)::uuid,('e7000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid) from unnest(array[3,5]) n;
select set_config('test.specs','{"save_rule":"{\"name\":\"save_rule\"}","suggest_rule":"{\"name\":\"suggest_rule\"}"}',true);
set local role service_role;
select is(public.pin_run('e6000000-0000-0000-0000-000000000005','e7000000-0000-0000-0000-000000000005',current_setting('test.specs')::jsonb),
 jsonb_build_object('tools','[{"name":"suggest_rule"}]','rules','[]'::jsonb),'another Member''s run starts without it, offered suggest_rule');
select is(public.pin_run('e6000000-0000-0000-0000-000000000003','e7000000-0000-0000-0000-000000000003',current_setting('test.specs')::jsonb),
 jsonb_build_object('tools','[{"name":"suggest_rule"}]','rules','[]'::jsonb),'nor does the Contributor''s own run: no run is told rules (#345)');
reset role;

-- Who reads it: its teller, the Owner and the Manager; and who sees it waiting: the Owner and the Manager.
create temporary table seen(n int, rules int, waiting int, logged int, audited int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*) from public.agent_rules),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='rule_suggestion'),
 (select count(*) from public.company_log where action='agent_rule_suggested'),(select count(*) from public.hermes_agent_audit where action='AGENT_RULE_SUGGESTED');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*) from public.agent_rules),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='rule_suggestion'),
 (select count(*) from public.company_log where action='agent_rule_suggested'),(select count(*) from public.hermes_agent_audit where action='AGENT_RULE_SUGGESTED');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*) from public.agent_rules),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='rule_suggestion'),
 (select count(*) from public.company_log where action='agent_rule_suggested'),(select count(*) from public.hermes_agent_audit where action='AGENT_RULE_SUGGESTED');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*) from public.agent_rules),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='rule_suggestion'),
 (select count(*) from public.company_log where action='agent_rule_suggested'),(select count(*) from public.hermes_agent_audit where action='AGENT_RULE_SUGGESTED');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 5,(select count(*) from public.agent_rules),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='rule_suggestion'),
 (select count(*) from public.company_log where action='agent_rule_suggested'),(select count(*) from public.hermes_agent_audit where action='AGENT_RULE_SUGGESTED');
reset role;
select results_eq($$select * from seen order by n$$,$$values (1,1,1,1,1),(2,1,1,1,1),(3,1,0,1,1),(4,0,0,0,0),(5,0,0,0,0)$$,
 'the teller, the Owner and the Manager read the suggestion and its log line; only the Owner and the Manager have it waiting');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select results_eq($$select kind,title,body,asked_by from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='rule_suggestion'$$,
 $$values ('rule_suggestion','From now on, write every Saudi ad in a light Saudi dialect','Ads','مراجع')$$,'"Waiting on you" names the rule, the Agent and who told it');

-- Deciding: only from one's own item, only an Owner or a Manager.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.a1')::bigint,true)$$,'P0002',null,'the Contributor cannot approve it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.a1')::bigint,true)$$,'P0002',null,'nor can a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.a1')::bigint,true)$$,'P0002',null,'the Manager decides from their own item, not the Owner''s');
select throws_ok($$select public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.a2')::bigint,null)$$,'22023',null,'and says which way');
reset role;
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
update public.members set role='manager' where company_id='10000000-0000-0000-0000-000000000003' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.decide_agent_rule('10000000-0000-0000-0000-000000000003',current_setting('test.a1')::bigint,true)$$,'P0002',null,'a Manager of another Company finds nothing, named with their own Company');
select throws_ok($$select public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.a1')::bigint,true)$$,'P0002',null,'or with this one');
reset role;
update public.members set removed_at=null where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
update public.members set role='contributor' where company_id='10000000-0000-0000-0000-000000000003' and person_id='20000000-0000-0000-0000-000000000005';
select is((select suggestion from public.agent_rules where run_id='sg-a'),'pending','nobody of them decided it');

-- The Owner approves it: the team's from the next run on, gone from every list, logged once.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.a1')::bigint,true),'approved','the Owner approves it');
select is(public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.a1')::bigint,true),'approved','a second click answers the same');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.a2')::bigint,false)$$,'22023',null,'the Manager can no longer refuse it');
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='rule_suggestion'),0,'it left the Manager''s list too');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select body from public.agent_rules),'From now on, write every Saudi ad in a light Saudi dialect','every Member reads it now');
select results_eq($$select actor_id,details->>'rule',details->>'taught_by' from public.company_log where action='agent_rule_approved'$$,
 $$values ('20000000-0000-0000-0000-000000000001'::uuid,'From now on, write every Saudi ad in a light Saudi dialect','مراجع')$$,'and its approval in the log, once, with who taught it');
reset role;
select results_eq($$select suggestion,decided_by,decided_at is not null,said_by from public.agent_rules where run_id='sg-a'$$,
 $$values ('approved','20000000-0000-0000-0000-000000000001'::uuid,true,'20000000-0000-0000-0000-000000000003'::uuid)$$,'it keeps who told it, with who approved it and when');
select is((select count(*)::int from public.waiting_items where agent_rule_id=current_setting('test.a')::uuid and resolved_at is null),0,'no item for it is left open');
select is((select rules from public.agent_soul_rules_work() where profile='ag-e5000000000000000000000000000002'),'["From now on, write every Saudi ad in a light Saudi dialect"]'::jsonb,'approved, it is in the Agent''s SOUL.md for everyone');

-- The Manager refuses the next one: it never reaches the Agent's SOUL.md.
set local role service_role;
select is(public.agent_save_rule('e6000000-0000-0000-0000-000000000003','sg-b','call-0','From now on, no emojis')->>'state','suggested','the Contributor suggests another');
reset role;
update public.agent_rules set said_at=said_at+interval '1 minute' where run_id='sg-b';
select set_config('test.b',(select id::text from public.agent_rules where run_id='sg-b'),true);
select set_config('test.b1',(select id::text from public.waiting_items where agent_rule_id=current_setting('test.b')::uuid and person_id='20000000-0000-0000-0000-000000000001'),true);
select set_config('test.b2',(select id::text from public.waiting_items where agent_rule_id=current_setting('test.b')::uuid and person_id='20000000-0000-0000-0000-000000000002'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.b2')::bigint,false),'rejected','the Manager refuses it');
select is(public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.b2')::bigint,false),'rejected','a second click answers the same');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='rule_suggestion'),0,'it left the Owner''s list');
select throws_ok($$select public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.b1')::bigint,true)$$,'22023',null,'and the Owner can no longer approve it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.agent_rules where run_id='sg-b'),0,'another Member does not read it');
select is((select count(*)::int from public.company_log where action='agent_rule_rejected'),0,'nor its refusal in the log, which would show its words');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select actor_id,details->>'rule',details->>'taught_by' from public.company_log where action='agent_rule_rejected'$$,
 $$values ('20000000-0000-0000-0000-000000000002'::uuid,'From now on, no emojis','مراجع')$$,'its teller reads its refusal in the log, once');
select results_eq($$select suggestion,(select name from public.people where id=decided_by) from public.agent_rules where run_id='sg-b'$$,$$values ('rejected','مدير')$$,'its teller reads who refused it');
reset role;
select is((select rules from public.agent_soul_rules_work() where profile='ag-e5000000000000000000000000000002'),'["From now on, write every Saudi ad in a light Saudi dialect"]'::jsonb,'a refused one is not in the Agent''s SOUL.md');

-- A Manager who is no longer one, or no longer sees the Agent, has nothing left to decide.
set local role service_role;
select is(public.agent_save_rule('e6000000-0000-0000-0000-000000000003','sg-c','call-0','From now on, answer within the hour')->>'state','suggested','a third suggestion');
reset role;
select set_config('test.d',(select id::text from public.agent_rules where run_id='sg-c'),true);
select set_config('test.d1',(select id::text from public.waiting_items where agent_rule_id=current_setting('test.d')::uuid and person_id='20000000-0000-0000-0000-000000000001'),true);
select set_config('test.d2',(select id::text from public.waiting_items where agent_rule_id=current_setting('test.d')::uuid and person_id='20000000-0000-0000-0000-000000000002'),true);
update public.members set role='contributor' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='rule_suggestion'),0,'a Manager made a Contributor no longer has it waiting');
select throws_ok($$select public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.d2')::bigint,true)$$,'42501',null,'and may not decide it');
reset role;
update public.members set role='manager' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000002';
delete from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000002' and agent_id='e5000000-0000-0000-0000-000000000002';
set local role authenticated;
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='rule_suggestion'),0,'nor does a Manager Ads is hidden from');
select throws_ok($$select public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.d2')::bigint,true)$$,'P0002',null,'who finds nothing to decide');
reset role;
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','e5000000-0000-0000-0000-000000000002');

-- A suggestion removed while it waits leaves every list.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.remove_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.d')::uuid),true,'the Owner removes the waiting suggestion');
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='rule_suggestion'),0,'it left the Owner''s list');
select throws_ok($$select public.decide_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.d1')::bigint,true)$$,'P0002',null,'and cannot be decided');
reset role;
select is((select count(*)::int from public.waiting_items where agent_rule_id=current_setting('test.d')::uuid and resolved_at is null),0,'no item for it is left open');
select set_config('test.dbody',(select body from public.agent_rules where id=current_setting('test.d')::uuid),true);
select is((select count(*)::int from public.company_log where action='agent_rule_removed' and details->>'rule'=current_setting('test.dbody')),1,'its removal is logged once');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.company_log where action='agent_rule_removed' and details->>'rule'=current_setting('test.dbody')),0,'another Member does not read its removal in the log');
reset role;

-- What the Owner or a Manager tells is the team's at once: no suggestion, nothing waiting.
set local role service_role;
select results_eq($$select public.agent_save_rule(('e6000000-0000-0000-0000-00000000000'||n)::uuid,run,'call-0',body)->>'state' from (values (1,'sg-e','From now on, send nothing to a customer before I see it'),(2,'sg-f','From now on, keep every ad under 90 characters')) x(n,run,body)$$,
 $$values ('saved'),('saved')$$,'the Owner''s rule and the Manager''s are saved');
reset role;
update public.agent_rules set said_at=said_at+case run_id when 'sg-e' then interval '2 minutes' else interval '3 minutes' end where run_id in ('sg-e','sg-f');
select is((select count(*)::int from public.agent_rules where run_id in ('sg-e','sg-f') and suggestion is null),2,'for the team');
select is((select count(*)::int from public.waiting_items where agent_rule_id in (select id from public.agent_rules where run_id in ('sg-e','sg-f'))),0,'with nothing waiting on anyone');
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 values ('e6000000-0000-0000-0000-000000000005','e7000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000005','e5000000-0000-0000-0000-000000000002','Draft the teaser','suggest-test');
select public.pinned_run_note('e6000000-0000-0000-0000-000000000005','e7000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005');
set local role service_role;
select is(public.pin_run('e6000000-0000-0000-0000-000000000005','e7000000-0000-0000-0000-000000000006',current_setting('test.specs')::jsonb)->'rules',
 jsonb_build_array('From now on, write every Saudi ad in a light Saudi dialect','From now on, send nothing to a customer before I see it','From now on, keep every ad under 90 characters'),
 'another Member''s next run carries them, after the approved one');
reset role;
select * from finish();
rollback;
