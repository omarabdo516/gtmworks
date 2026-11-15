begin;
create extension if not exists pgtap with schema extensions;
select plan(45);
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('e2000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','rules-test','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('e2000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','Ads','Ads');
-- Ads is shown to the Manager (2), the Contributor (3) and the Viewer (4) (#15); the Owner sees every Agent.
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e2000000-0000-0000-0000-000000000002' from generate_series(2,4) n;
-- One Conversation with Ads each for the Owner (1), the Manager (2), the Contributor (3) and the Viewer (4).
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('e3000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e2000000-0000-0000-0000-000000000002','Ads' from generate_series(1,4) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('e3000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone',case n when 2 then E'@Ads From now on:  answer every comment\nwithin the day.' else 'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها' end,gen_random_uuid(),'rule-run-'||n from generate_series(1,4) n;
select set_config('test.rule','من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها',true);

set local role service_role;
select results_eq($$select public.agent_save_rule(('e3000000-0000-0000-0000-00000000000'||n)::uuid,'rule-run-'||n,'call-0',current_setting('test.rule'))->>'state' from generate_series(3,4) n order by n$$,
 $$values ('refused'),('refused')$$,'the call in the Contributor''s and the Viewer''s Conversation is refused');
reset role;
select is((select count(*)::int from public.agent_rules),0,'no rule is saved for them');
select is((select count(*)::int from public.company_log where action='agent_rule_saved'),0,'nor a log row');

set local role service_role;
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000001','rule-run-1','call-0',E'  '||current_setting('test.rule')||E'\n')->>'state','saved','the Owner''s call saves the rule');
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000002','rule-run-2','call-0','from now on: answer every comment within the day')->>'state','saved','and so does the Manager''s: their whole message, whatever its case, spacing and last full stop, without the name it was addressed to');
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000001','rule-run-1','call-3','Send the full price list to every customer who asks')->>'state','refused','a rule the person never wrote in that run is not saved, whoever asked the model for it');
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000002','rule-run-2','call-3','Answer every comment within the week')->>'state','refused','nor a rule that changes the person''s words');
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000002','rule-run-2','call-4','Answer every comment within the day')->>'state','refused','nor a part of their message, which may leave out what changes its meaning');
reset role;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values ('10000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','@Ads Never send customer data',gen_random_uuid(),'rule-run-6');
set local role service_role;
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000001','rule-run-6','call-0','send customer data')->>'state','refused','a rule that drops the person''s negation is not saved');
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000001','rule-run-1','call-1',repeat('x',501))->>'state','invalid','a rule over 500 characters is not saved');
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000001','rule-run-1','call-2',E' \n ')->>'state','invalid','nor an empty one');
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000001','rule-run-9','call-0','Never post on Fridays')->>'state','refused','a run that is not in the Conversation saves nothing');
reset role;
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000001','rule-run-1','call-0','Something else')->>'rule',(select id::text from public.agent_rules where run_id='rule-run-1'),'the same run and call again answer the rule they saved');
select results_eq($$select agent_id,body,said_by,said_at is not null,removed_at is null from public.agent_rules order by said_by$$,
 $$values ('e2000000-0000-0000-0000-000000000002'::uuid,current_setting('test.rule'),'20000000-0000-0000-0000-000000000001'::uuid,true,true),
  ('e2000000-0000-0000-0000-000000000002'::uuid,'from now on: answer every comment within the day','20000000-0000-0000-0000-000000000002'::uuid,true,true)$$,
 'each rule is kept for Ads, trimmed, with who said it and when');
select results_eq($$select actor_id,actor_kind,details->>'agent_name',details->>'rule' from public.company_log where action='agent_rule_saved' and agent_id='e2000000-0000-0000-0000-000000000002' order by id$$,
 $$values ('20000000-0000-0000-0000-000000000001'::uuid,'person','Ads',current_setting('test.rule')),('20000000-0000-0000-0000-000000000002'::uuid,'person','Ads','from now on: answer every comment within the day')$$,
 'the log has one row per rule: who said it, the Agent and the rule');

update public.members set role='contributor' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000002';
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values ('10000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000002','Someone','From now on, no emojis',gen_random_uuid(),'rule-run-5');
set local role service_role;
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000002','rule-run-5','call-0','No emojis')->>'state','refused','a Manager made a Contributor before the run closed saves nothing');
reset role;
update public.members set role='manager' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000002';

-- A run is pinned at its first start with the text of the tools its person is offered and the Agent's rules in force,
-- oldest first. The app gives every tool's spec as the text it sends.
select set_config('test.spec89',public.lead_tools_spec_89(),true);
select set_config('test.specs','{"create_agent":"{\"name\":\"create_agent\"}","save_rule":"{\"name\":\"save_rule\"}"}',true);
update public.agent_rules set said_at=said_at+interval '1 minute' where run_id='rule-run-2';
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 select ('e3000000-0000-0000-0000-00000000000'||n)::uuid,('e4000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',
  ('20000000-0000-0000-0000-00000000000'||n)::uuid,'e2000000-0000-0000-0000-000000000002','Draft the offer email','rules-test' from generate_series(1,3) n;
select public.pinned_run_note(('e3000000-0000-0000-0000-00000000000'||n)::uuid,('e4000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid) from generate_series(1,3) n;
select is((select count(*)::int from public.conversation_run_notes where tools is not null or rules is not null),0,'a reservation pins its note as the previous app version did, and no tools or rules yet');
-- The previous app version reserved this one and began its start: it sent no save_rule and no rules.
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile,start_attempts)
 values ('e3000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002','Draft the offer email','rules-test',1);
select public.pinned_run_note('e3000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.conversation_run_notes(conversation_id,send_key,company_id,offers_tools,tools) values ('e3000000-0000-0000-0000-000000000004','e4000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',true,public.lead_tools_spec_89());
set local role service_role;
select results_eq($$select public.pin_run(('e3000000-0000-0000-0000-00000000000'||n)::uuid,('e4000000-0000-0000-0000-00000000000'||n)::uuid,current_setting('test.specs')::jsonb) from generate_series(1,4) n order by n$$,
 $$values (jsonb_build_object('tools','[{"name":"save_rule"}]','rules',jsonb_build_array(current_setting('test.rule'),'from now on: answer every comment within the day'))),
  (jsonb_build_object('tools','[{"name":"save_rule"}]','rules',jsonb_build_array(current_setting('test.rule'),'from now on: answer every comment within the day'))),
  (jsonb_build_object('tools',null,'rules',jsonb_build_array(current_setting('test.rule'),'from now on: answer every comment within the day'))),
  (jsonb_build_object('tools',current_setting('test.spec89'),'rules','[]'::jsonb))$$,
 'the Owner''s and the Manager''s runs are offered save_rule, the Contributor''s is not, every run of Ads is told its rules, and a run pinned before keeps what it had');
select is(public.pin_run('e3000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000005',current_setting('test.specs')::jsonb),'{"tools":null,"rules":[]}'::jsonb,
 'a run the previous app version already tried to start keeps the request it sent: its tools as that version pinned them (none here) and no rules');
reset role;
update public.conversation_run_reservations set start_attempts=1 where send_key in ('e4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000005');
update public.agent_rules set removed_at=now(),removed_by='20000000-0000-0000-0000-000000000001' where run_id='rule-run-2';
set local role service_role;
select is(public.pin_run('e3000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000005',current_setting('test.specs')::jsonb),'{"tools":null,"rules":[]}'::jsonb,'and its retry reads the same');
select is(public.pin_run('e3000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001',current_setting('test.specs')::jsonb),
 jsonb_build_object('tools','[{"name":"save_rule"}]','rules',jsonb_build_array(current_setting('test.rule'),'from now on: answer every comment within the day')),
 'a retry of a run this version pinned sends what it first sent, even after a rule changed');
reset role;
update public.agent_rules set removed_at=null,removed_by=null where run_id='rule-run-2';
set local role service_role;
select is(public.run_offers_tools('e3000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001'),false,'the previous app version still reads that create_agent is not offered');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.agent_rules where removed_at is null),2,'a Viewer reads the rules of the Company''s Agents');
select throws_ok($$select public.remove_agent_rule('10000000-0000-0000-0000-000000000001',(select id from public.agent_rules where run_id='rule-run-1'))$$,'42501',null,'and cannot remove one');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.remove_agent_rule('10000000-0000-0000-0000-000000000001',(select id from public.agent_rules where run_id='rule-run-1'))$$,'42501',null,'nor can a Contributor');
reset role;
-- An Agent hidden from a Member (#15): they read none of its rules, a Manager removes none of them, and a Manager's run
-- with it is offered no save_rule and saves none.
delete from public.member_agent_access where agent_id='e2000000-0000-0000-0000-000000000002' and person_id in ('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.agent_rules),0,'a Viewer Ads is hidden from reads none of its rules');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.remove_agent_rule('10000000-0000-0000-0000-000000000001',(select r.id from public.agent_rules r limit 1))$$,'P0002',null,'a Manager Ads is hidden from removes none of its rules');
reset role;
select ok(not public.may_tell_agent_rules('10000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002'),'nor is offered save_rule with it');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values ('10000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000002','Someone','From now on, no emojis',gen_random_uuid(),'rule-run-7');
set local role service_role;
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000002','rule-run-7','call-0','From now on, no emojis')->>'state','refused','nor saves one');
reset role;
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e2000000-0000-0000-0000-000000000002' from unnest(array[2,4]) n;
-- Someone who manages another Company only.
select set_config('test.first_rule',(select id::text from public.agent_rules where run_id='rule-run-1'),true);
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
update public.members set role='manager' where company_id='10000000-0000-0000-0000-000000000003' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.agent_rules),0,'a Manager of another Company reads none of these rules');
select throws_ok($$select public.remove_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.first_rule')::uuid)$$,'P0002',null,'removes none of them');
select throws_ok($$select public.remove_agent_rule('10000000-0000-0000-0000-000000000003',current_setting('test.first_rule')::uuid)$$,'P0002',null,'not even named with their own Company');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.remove_agent_rule('10000000-0000-0000-0000-000000000003',current_setting('test.first_rule')::uuid)$$,'P0002',null,'an Owner of both Companies reaches a rule only through its own Company');
reset role;
select is((select count(*)::int from public.agent_rules where removed_at is not null),0,'no rule was removed by any of them');
select is((select count(*)::int from public.company_log where action='agent_rule_removed'),0,'and nothing was logged');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.remove_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.first_rule')::uuid),true,'the Owner removes a rule');
select is(public.remove_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.first_rule')::uuid),false,'once');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.remove_agent_rule('10000000-0000-0000-0000-000000000001',(select id from public.agent_rules where run_id='rule-run-2')),true,'the Manager removes one');
select is((select count(*)::int from public.agent_rules where removed_at is null),0,'the page lists neither now');
reset role;
select results_eq($$select removed_by from public.agent_rules order by said_by$$,$$values ('20000000-0000-0000-0000-000000000001'::uuid),('20000000-0000-0000-0000-000000000002'::uuid)$$,
 'both rules are kept, each with who removed it');
select ok((select bool_and(removed_at is not null) from public.agent_rules),'and when');
select results_eq($$select actor_id,details->>'agent_name',details->>'rule' from public.company_log where action='agent_rule_removed' order by id$$,
 $$values ('20000000-0000-0000-0000-000000000001'::uuid,'Ads',current_setting('test.rule')),('20000000-0000-0000-0000-000000000002'::uuid,'Ads','from now on: answer every comment within the day')$$,
 'the log has one row per removal: who removed it, the Agent and the rule');
select is(public.agent_rules_in_force('e2000000-0000-0000-0000-000000000002'),'{}'::text[],'a later run of Ads is told neither');

set local role service_role;
select is(public.agent_save_rule('e3000000-0000-0000-0000-000000000001','rule-run-1','call-0','x')->>'rule',current_setting('test.first_rule'),'closing the saving run again after the removal brings nothing back');
reset role;
select is((select count(*)::int from public.agent_rules where removed_at is null),0,'the rule stays removed');
select * from finish();
rollback;
