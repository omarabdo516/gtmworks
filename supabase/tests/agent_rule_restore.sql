begin;
create extension if not exists pgtap with schema extensions;
select plan(21);
-- #28: an Owner or a Manager brings back a rule they removed. The row is kept and only its removal is cleared; the
-- database logs AGENT_RULE_RESTORED once, and only people who may give that Agent rules today may restore.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('e6000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000001','Ads','Ads','rules-restore');
-- Ads is shown to the Manager (2), the Contributor (3) and the Viewer (4) (#15); the Owner sees every Agent.
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e6000000-0000-0000-0000-000000000002' from generate_series(2,4) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('e6000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000002','Ads');
insert into public.agent_rules(company_id,agent_id,body,said_by,conversation_id,run_id,call_id) values
 ('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000002','من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها','20000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000003','rule-run-1','call-0'),
 ('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000002','Answer every comment within the day','20000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000003','rule-run-2','call-0');
select set_config('test.restore_rule',(select id::text from public.agent_rules where run_id='rule-run-1'),true);
select set_config('test.other_rule',(select id::text from public.agent_rules where run_id='rule-run-2'),true);

-- A Contributor or a Viewer may read the rules and may not bring one back; nothing is restored and nothing logged.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.restore_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.restore_rule')::uuid)$$,'42501',null,'a Contributor cannot bring back a rule');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.restore_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.restore_rule')::uuid)$$,'42501',null,'nor can a Viewer');
reset role;
select is((select count(*)::int from public.agent_rules where removed_at is null),2,'neither of them changed a rule');
select is((select count(*)::int from public.company_log where action='agent_rule_restored'),0,'and nothing was logged');

-- The Owner removes one rule, which is what a restore brings back.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.remove_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.restore_rule')::uuid),true,'the Owner forgets a rule');
reset role;
select is((select removed_by from public.agent_rules where id=current_setting('test.restore_rule')::uuid),'20000000-0000-0000-0000-000000000001'::uuid,'the rule is marked removed by the Owner');
select is((select count(*)::int from public.company_log where action='agent_rule_removed'),1,'and the removal is one log row');

-- A Manager Ads is hidden from cannot bring it back, nor can a Manager of another Company, nor the Owner through
-- another Company's id.
delete from public.member_agent_access where agent_id='e6000000-0000-0000-0000-000000000002' and person_id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.restore_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.restore_rule')::uuid)$$,'P0002',null,'a Manager Ads is hidden from restores none of its rules');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.restore_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.restore_rule')::uuid)$$,'P0002',null,'a Manager of another Company restores none of them');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.restore_agent_rule('10000000-0000-0000-0000-000000000003',current_setting('test.restore_rule')::uuid)$$,'P0002',null,'an Owner of both Companies reaches a rule only through its own Company');
reset role;
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','e6000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.agent_rules where removed_at is null),1,'no restore happened');

-- The Owner brings the rule back: the row is the same one, its removal cleared, and the log says so once.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.restore_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.restore_rule')::uuid),true,'the Owner brings the rule back');
reset role;
select results_eq($$select removed_at is null,removed_by is null,body from public.agent_rules where id=current_setting('test.restore_rule')::uuid$$,
 $$values (true,true,'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها'::text)$$,'the rule is in force again, with its own words');
select results_eq($$select action,actor_id,agent_id,details->>'rule' from public.company_log where action='agent_rule_restored'$$,
 $$values ('agent_rule_restored'::text,'20000000-0000-0000-0000-000000000001'::uuid,'e6000000-0000-0000-0000-000000000002'::uuid,'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها'::text)$$,
 'the log names the Owner, the Agent and the rule');
select is((select count(*)::int from public.company_log where action='agent_rule_removed'),1,'the removal keeps its own row');

-- A rule already in force is not restored again, and a suggestion that was never approved cannot be brought back.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.restore_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.restore_rule')::uuid),false,'a rule in force is restored only once');
reset role;
insert into public.agent_rules(company_id,agent_id,body,said_by,conversation_id,run_id,call_id,suggestion,removed_at,removed_by) values
 ('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000002','A suggestion never approved','20000000-0000-0000-0000-000000000003','e6000000-0000-0000-0000-000000000003','rule-run-3','call-0','pending',now(),'20000000-0000-0000-0000-000000000001');
insert into public.agent_rules(company_id,agent_id,body,said_by,conversation_id,run_id,call_id,suggestion,decided_by,decided_at,removed_at,removed_by) values
 ('10000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000002','A suggestion the team refused','20000000-0000-0000-0000-000000000003','e6000000-0000-0000-0000-000000000003','rule-run-4','call-0','rejected','20000000-0000-0000-0000-000000000001',now(),now(),'20000000-0000-0000-0000-000000000001');
select set_config('test.pending_rule',(select id::text from public.agent_rules where run_id='rule-run-3'),true);
select set_config('test.rejected_rule',(select id::text from public.agent_rules where run_id='rule-run-4'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.restore_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.pending_rule')::uuid),false,'a suggestion that never got an OK is not brought back');
select is(public.restore_agent_rule('10000000-0000-0000-0000-000000000001',current_setting('test.rejected_rule')::uuid),false,'nor one the team refused');
reset role;
select is((select count(*)::int from public.company_log where action='agent_rule_restored'),1,'neither restore wrote a row');

-- Callers who may not restore, and signed-out callers, are refused before the rule is read.
select ok(has_function_privilege('authenticated','public.restore_agent_rule(uuid,uuid)','execute'),'a signed-in Manager reaches the restore function');
select ok(not has_function_privilege('anon','public.restore_agent_rule(uuid,uuid)','execute') and not has_function_privilege('service_role','public.restore_agent_rule(uuid,uuid)','execute'),'and no signed-out or service caller does');
select * from finish();
rollback;
