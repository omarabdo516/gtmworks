begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
-- #484: "Edit, then approve". The Owner claims a proposal with another value of the same change; the claim answers that
-- value to write, the proposal keeps what the Agent proposed beside it, and the approval logs both. An edit that is not
-- a valid value is refused, one equal to the proposal approves as proposed, a claim given back drops the edit, and a
-- decline after an unconfirmed claim keeps it.
-- RS Learning: 1 Owner, 2 Manager.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('ee000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ee000000-0000-0000-0000-000000000001','Lead','General',true,'co-10000000000000000000000000000001'),
 ('ee000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','ee000000-0000-0000-0000-000000000003','Analyst','Numbers',false,'edit-test-analyst');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('ef000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','ee000000-0000-0000-0000-000000000002','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values ('10000000-0000-0000-0000-000000000001','ef000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','The 90-day report is late',gen_random_uuid(),'ed-1');
select set_config('test.c','10000000-0000-0000-0000-000000000001',true);
set local role service_role;
select public.agent_propose_change('ef000000-0000-0000-0000-000000000001','ed-1','call-'||n,'Analyst',change,setting,value::jsonb,'The report is late.')
 from (values (1,'model',null,'"google/gemini-2.5-pro"'),(2,'setting','timezone','"Africa/Cairo"'),(3,'toolset','delegation','true'),(4,'model',null,'"openai/gpt-5"')) v(n,change,setting,value);
reset role;
select set_config('test.model',(select id::text from public.agent_change_proposals where call_id='call-1'),true);
select set_config('test.zone',(select id::text from public.agent_change_proposals where call_id='call-2'),true);
select set_config('test.sub',(select id::text from public.agent_change_proposals where call_id='call-3'),true);
select set_config('test.late',(select id::text from public.agent_change_proposals where call_id='call-4'),true);

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.claim_agent_change(current_setting('test.c')::uuid,current_setting('test.model')::bigint,'"anthropic/claude-opus-5-5"')$$,'42501','agentChangeNotAllowed','a Manager may not approve with changes');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.claim_agent_change(current_setting('test.c')::uuid,current_setting('test.model')::bigint,'"not a model"')$$,'22023','agentChangeEditInvalid','an edit that is not provider/model is refused');
select throws_ok($$select public.claim_agent_change(current_setting('test.c')::uuid,current_setting('test.sub')::bigint,'"on"')$$,'22023','agentChangeEditInvalid','the sub-agents switch is edited to on or off only');
reset role;
select is((select state from public.agent_change_proposals where id=current_setting('test.model')::bigint),'waiting','a refused edit leaves the proposal waiting');

-- The model, edited: the claim answers the Owner's value, the row keeps both, and the approval logs both.
set local role authenticated;
select set_config('test.claim1',public.claim_agent_change(current_setting('test.c')::uuid,current_setting('test.model')::bigint,'"anthropic/claude-opus-5-5"')::text,true);
select is(current_setting('test.claim1')::jsonb-'token',jsonb_build_object('state','claimed','retry',false,'agent','ee000000-0000-0000-0000-000000000004','change','model',
 'setting',null,'value','anthropic/claude-opus-5-5','edited',true),'the claim answers the edited value to write');
select is(public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.model')::bigint,true,null,(current_setting('test.claim1')::jsonb->>'token')::uuid),'approved','and the Owner approves it');
reset role;
select results_eq($$select value,approved_value,state from public.agent_change_proposals where id=current_setting('test.model')::bigint$$,
 $$values ('"google/gemini-2.5-pro"'::jsonb,'"anthropic/claude-opus-5-5"'::jsonb,'approved')$$,'the proposal keeps what the Agent proposed and what the Owner approved');
select results_eq($$select details->'new',details->'proposed',details->'edited' from public.company_log where action='agent_change_approved' and agent_id='ee000000-0000-0000-0000-000000000004'$$,
 $$values ('"anthropic/claude-opus-5-5"'::jsonb,'"google/gemini-2.5-pro"'::jsonb,'true'::jsonb)$$,'the log names the value approved and the one proposed');

-- An edit equal to the proposal approves as proposed.
set local role authenticated;
select set_config('test.claim2',public.claim_agent_change(current_setting('test.c')::uuid,current_setting('test.zone')::bigint,'"Africa/Cairo"')::text,true);
select is((current_setting('test.claim2')::jsonb->>'edited')::boolean,false,'an edit that changes nothing is no edit');
select lives_ok($$select public.release_agent_change(current_setting('test.c')::uuid,current_setting('test.zone')::bigint,(current_setting('test.claim2')::jsonb->>'token')::uuid)$$,'and it is given back');
-- A claim given back drops its edit.
select set_config('test.claim3',public.claim_agent_change(current_setting('test.c')::uuid,current_setting('test.zone')::bigint,'"Europe/London"')::text,true);
select lives_ok($$select public.release_agent_change(current_setting('test.c')::uuid,current_setting('test.zone')::bigint,(current_setting('test.claim3')::jsonb->>'token')::uuid)$$,'a write refused before the Engine gives the claim back');
reset role;
select results_eq($$select state,approved_value from public.agent_change_proposals where id=current_setting('test.zone')::bigint$$,$$values ('waiting',null::jsonb)$$,
 'and the proposal waits again as the Agent proposed it');

-- Approving again after an unconfirmed write writes what that approval says; the previous app's claim approves as proposed.
set local role authenticated;
select set_config('test.claim4',public.claim_agent_change(current_setting('test.c')::uuid,current_setting('test.sub')::bigint,'false')::text,true);
select lives_ok($$select public.release_agent_change(current_setting('test.c')::uuid,current_setting('test.sub')::bigint,(current_setting('test.claim4')::jsonb->>'token')::uuid,true)$$,'an unconfirmed write keeps the claim');
select is(public.claim_agent_change(current_setting('test.c')::uuid,current_setting('test.sub')::bigint)-'token',jsonb_build_object('state','claimed','retry',true,
 'agent','ee000000-0000-0000-0000-000000000004','change','toolset','setting','delegation','value',true),'the previous app''s claim takes it over and writes the proposed value');

-- A decline of an unconfirmed edited claim keeps the edit, as it may already be in the Agent's settings.
select set_config('test.claim5',public.claim_agent_change(current_setting('test.c')::uuid,current_setting('test.late')::bigint,'"anthropic/claude-sonnet-5-5"')::text,true);
select lives_ok($$select public.release_agent_change(current_setting('test.c')::uuid,current_setting('test.late')::bigint,(current_setting('test.claim5')::jsonb->>'token')::uuid,true)$$,'another unconfirmed write');
select is(public.answer_agent_change(current_setting('test.c')::uuid,current_setting('test.late')::bigint,false,'Not now.'),'declined','is declined');
reset role;
select results_eq($$select maybe_applied,approved_value from public.agent_change_proposals where id=current_setting('test.late')::bigint$$,
 $$values (true,'"anthropic/claude-sonnet-5-5"'::jsonb)$$,'and keeps the edit its earlier approval may have written');
select * from finish();
rollback;
