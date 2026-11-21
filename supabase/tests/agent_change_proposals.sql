begin;
create extension if not exists pgtap with schema extensions;
select plan(34);
-- #19: an Agent proposes a change to its own profile, or Lead to another Agent's, and the proposal waits for an Owner.
-- The database keeps what would change, the reason and the state; a change that is not on the list is kept as refused
-- and waits on nobody. Only an active Owner approves or declines, and both answers are logged.
-- RS Learning: 1 Owner, 2 Manager, 3 Contributor, 4 Viewer; Ads is shown to the Manager and the Viewer.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('ec000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ec000000-0000-0000-0000-000000000001','Lead','General',true,'co-10000000000000000000000000000001'),
 ('ec000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','ec000000-0000-0000-0000-000000000003','Ads','Ads',false,'change-test-ads');
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','ec000000-0000-0000-0000-000000000004'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','ec000000-0000-0000-0000-000000000004');
-- ed…1: the Owner with Lead; ed…2: the Manager with Ads; ed…4: the Viewer with Ads.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('ed000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','ec000000-0000-0000-0000-000000000002','Lead'),
 ('ed000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','ec000000-0000-0000-0000-000000000004','Ads'),
 ('ed000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','ec000000-0000-0000-0000-000000000004','Ads');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('ed000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone',
  'The weekly report is late again',gen_random_uuid(),'ch-'||n from unnest(array[1,2,4]) n;
select set_config('test.c','10000000-0000-0000-0000-000000000001',true);

set local role service_role;
select is(public.agent_propose_change('ed000000-0000-0000-0000-000000000002','ch-2','call-0',null,'model',null,'"anthropic/claude-sonnet-5-5"',' Faster on big numbers. ')->>'state','proposed',
 'an Agent proposes a model for itself');
select is(public.agent_propose_change('ed000000-0000-0000-0000-000000000001','ch-1','call-0','ads','instructions',null,'"You write short ad copy."','Its copy runs long.')->>'state','proposed',
 'Lead proposes new instructions for another Agent, named as the team knows it');
select is(public.agent_propose_change('ed000000-0000-0000-0000-000000000002','ch-2','call-1','Lead','model',null,'"openai/gpt-5"','Lead is slow.')->>'state','ignored',
 'an Agent that is not Lead proposes nothing for another Agent');
select is(public.agent_propose_change('ed000000-0000-0000-0000-000000000001','ch-1','call-1',null,'setting','terminal.backend','"local"','I need a shell.')->>'state','refused',
 'a setting that is not on the list is refused');
select is(public.agent_propose_change('ed000000-0000-0000-0000-000000000001','ch-1','call-2',null,'toolset','terminal','true','I need a shell.')->>'state','refused',
 'and so is a toolset above the Agent level');
select is(public.agent_propose_change('ed000000-0000-0000-0000-000000000001','ch-1','call-3',null,'model',null,'"not a model"','Better.')->>'state','refused',
 'and a model that is not provider/model');
select is(public.agent_propose_change('ed000000-0000-0000-0000-000000000001','ch-1','call-4',null,'toolset','delegation','true',' ')->>'state','invalid',
 'a proposal with no reason keeps nothing');
select is(public.agent_propose_change('ed000000-0000-0000-0000-000000000004','ch-4','call-0',null,'model',null,'"openai/gpt-5"','Faster.')->>'state','refused',
 'a Viewer''s Conversation proposes nothing');
select is(public.agent_propose_change('ed000000-0000-0000-0000-000000000002','ch-9','call-0',null,'model',null,'"openai/gpt-5"','Faster.')->>'state','refused',
 'nor a run that is not in the Conversation');
reset role;
select set_config('test.model',(select id::text from public.agent_change_proposals where run_id='ch-2' and call_id='call-0'),true);
select set_config('test.soul',(select id::text from public.agent_change_proposals where run_id='ch-1' and call_id='call-0'),true);
select set_config('test.refused',(select id::text from public.agent_change_proposals where run_id='ch-1' and call_id='call-1'),true);
set local role service_role;
select is(public.agent_propose_change('ed000000-0000-0000-0000-000000000002','ch-2','call-0',null,'setting','timezone','"Africa/Cairo"','Other.'),
 jsonb_build_object('state','proposed','proposal',current_setting('test.model')::bigint),'closing the run again answers the same proposal');
reset role;
select results_eq($$select agent_id,proposed_by,asked_by,change,setting,value,reason,state,answered_by is null and answered_at is null from public.agent_change_proposals order by id$$,
 $$values ('ec000000-0000-0000-0000-000000000004'::uuid,'ec000000-0000-0000-0000-000000000004'::uuid,'20000000-0000-0000-0000-000000000002'::uuid,'model',null::text,'"anthropic/claude-sonnet-5-5"'::jsonb,'Faster on big numbers.','waiting',true),
  ('ec000000-0000-0000-0000-000000000004'::uuid,'ec000000-0000-0000-0000-000000000002'::uuid,'20000000-0000-0000-0000-000000000001'::uuid,'instructions',null,'"You write short ad copy."','Its copy runs long.','waiting',true),
  ('ec000000-0000-0000-0000-000000000002'::uuid,'ec000000-0000-0000-0000-000000000002'::uuid,'20000000-0000-0000-0000-000000000001'::uuid,'setting','terminal.backend','"local"','I need a shell.','refused',true),
  ('ec000000-0000-0000-0000-000000000002'::uuid,'ec000000-0000-0000-0000-000000000002'::uuid,'20000000-0000-0000-0000-000000000001'::uuid,'toolset','terminal','true','I need a shell.','refused',true),
  ('ec000000-0000-0000-0000-000000000002'::uuid,'ec000000-0000-0000-0000-000000000002'::uuid,'20000000-0000-0000-0000-000000000001'::uuid,'model',null,'"not a model"','Better.','refused',true)$$,
 'two proposals wait, trimmed, each naming the Agent it would change and who proposed it; the three unlisted are refused');
select results_eq($$select actor_id,actor_kind,agent_id,details->>'setting',details->'new',details->>'private',details->>'teller' from public.company_log where action='agent_change_proposed' order by id$$,
 $$values ('ec000000-0000-0000-0000-000000000004'::uuid,'agent','ec000000-0000-0000-0000-000000000004'::uuid,'model','"anthropic/claude-sonnet-5-5"'::jsonb,'owners','20000000-0000-0000-0000-000000000002'),
  ('ec000000-0000-0000-0000-000000000002'::uuid,'agent','ec000000-0000-0000-0000-000000000004'::uuid,'instructions',null::jsonb,'owners','20000000-0000-0000-0000-000000000001')$$,
 'each waiting proposal is logged once, by the Agent that proposed it, without the instructions text; a refused one is not');
select throws_ok($$update public.agent_change_proposals set state='waiting' where id=current_setting('test.refused')::bigint$$,'23514',null,'a refused change can never be made to wait');

create temporary table seen(n int, proposals int, waiting int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*) from public.agent_change_proposals),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_change');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*) from public.agent_change_proposals),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_change');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*) from public.agent_change_proposals),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_change');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*) from public.agent_change_proposals),(select count(*) from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_change');
reset role;
select results_eq('select n,proposals,waiting from seen order by n',$$values (1,5,2),(2,1,0),(3,0,0),(4,0,0)$$,
 'the Owner reads every proposal and has the two waiting ones; the Manager reads the one from their Conversation and has none waiting; the others read none');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select results_eq($$select title,body,asked_by from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_change' order by id$$,
 $$values ('Ads','model','Ads'),('Ads','instructions','Lead')$$,'each item names the Agent it would change, what, and the Agent that proposed it');
reset role;

-- Only an active Owner answers.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.model')::bigint,true)$$,'42501','agentChangeNotAllowed','a Manager may not approve');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.model')::bigint,false,'No')$$,'42501','agentChangeNotAllowed','nor a Contributor decline');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.model')::bigint,true)$$,'42501','agentChangeNotAllowed','nor a Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.answer_agent_change('10000000-0000-0000-0000-000000000003',current_setting('test.model')::bigint,true)$$,'P0002','agentChangeNotFound','a proposal of this Company is not found in another');
select throws_ok($$select public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.refused')::bigint,true)$$,'22023','agentChangeAnswered','a refused proposal cannot be approved');
select throws_ok($$select public.answer_agent_change(current_setting('test.c')::uuid,999999,true)$$,'P0002','agentChangeNotFound','a proposal that does not exist is not found');
select throws_ok($$select public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.model')::bigint,null)$$,'22023','agentChangeAnswerMissing','an answer needs yes or no');
select is(public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.model')::bigint,true),'approved','the Owner approves one');
select is(public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.model')::bigint,true),'approved','and approving again answers the same');
select throws_ok($$select public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.model')::bigint,false)$$,'22023','agentChangeAnswered','but it cannot then be declined');
select throws_ok($$select public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.soul')::bigint,false,repeat('x',1001))$$,'22023','agentChangeReasonLong','a reason over 1,000 characters is refused');
select is(public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.soul')::bigint,false,' Keep it as it is this month. '),'declined','and declines the other, with a reason');
select is((select count(*)::int from public.waiting_list(current_setting('test.c')::uuid) where kind='agent_change'),0,'nothing waits any more');
reset role;
select results_eq($$select state,answered_by,answer from public.agent_change_proposals where id in (current_setting('test.model')::bigint,current_setting('test.soul')::bigint) order by id$$,
 $$values ('approved','20000000-0000-0000-0000-000000000001'::uuid,null::text),('declined','20000000-0000-0000-0000-000000000001'::uuid,'Keep it as it is this month.')$$,
 'each answer names the Owner, and the decline keeps its reason');
select results_eq($$select action,actor_id,actor_kind,agent_id,details->>'setting',details->>'reason',details->>'asked_by',details->>'private',details->>'teller' from public.company_log where action in ('agent_change_approved','agent_change_declined') order by id$$,
 $$values ('agent_change_approved','20000000-0000-0000-0000-000000000001'::uuid,'person','ec000000-0000-0000-0000-000000000004'::uuid,'model',null::text,'Ads','owners','20000000-0000-0000-0000-000000000002'),
  ('agent_change_declined','20000000-0000-0000-0000-000000000001'::uuid,'person','ec000000-0000-0000-0000-000000000004'::uuid,'instructions','Keep it as it is this month.','Lead','owners','20000000-0000-0000-0000-000000000001')$$,
 'both outcomes are logged once, by the Owner');

-- The Manager reads the outcome of the proposal from their Conversation in the log, and the Contributor reads neither.
create temporary table logged(n int, rows int);
grant insert on logged to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into logged select 2,(select count(*) from public.company_log where action like 'agent_change_%');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into logged select 3,(select count(*) from public.company_log where action like 'agent_change_%');
reset role;
select results_eq('select n,rows from logged order by n',$$values (2,2),(3,0)$$,'the log rows stay with the Owners and the person whose Conversation it came from');

select ok(not has_function_privilege('authenticated','public.agent_propose_change(uuid,text,text,text,text,text,jsonb,text)','execute'),'a signed-in person cannot keep a proposal themselves');
select ok(not has_function_privilege('anon','public.answer_agent_change(uuid,bigint,boolean,text)','execute'),'and nobody signed out answers one');
select ok(not has_table_privilege('authenticated','public.agent_change_proposals','insert,update,delete'),'nor writes the table');
select * from finish();
rollback;
