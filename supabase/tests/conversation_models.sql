begin;
create extension if not exists pgtap with schema extensions;
select plan(21);
-- #158. Ads in RS Learning, shown to every Member; one Conversation with Ads each for the Owner (1), the Manager (2), a
-- Contributor (3) and the Viewer (4), and a second one for the Owner.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('e8000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','model-test','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('e8000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001','Ads','Ads');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e8000000-0000-0000-0000-000000000002' from generate_series(2,4) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('e9000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e8000000-0000-0000-0000-000000000002','Ads' from generate_series(1,4) n;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e9000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000002','Ads');
select set_config('test.pick','{"provider":"openrouter","model":"openai/gpt-5.5"}',true);
-- Two of the Owner's messages waited their turn (conversation_queued_turns), with the keys their Runs are pinned under below.
insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message)
 select 'e9000000-0000-0000-0000-000000000001',('ea000000-0000-0000-0000-00000000000'||k)::uuid,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000002','Draft the offer email' from unnest(array[1,2]) k;

-- Only the Owner picks, and only in their own Conversation.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.set_conversation_model('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001',current_setting('test.pick')::jsonb),current_setting('test.pick')::jsonb,'the Owner picks a model for their Conversation');
select is((select model from public.conversations where id='e9000000-0000-0000-0000-000000000001'),current_setting('test.pick')::jsonb,'and reads it on the Conversation');
select is((select model from public.conversations where id='e9000000-0000-0000-0000-000000000009'),null,'their other Conversation with the same Agent is unchanged');
select throws_ok($$select public.set_conversation_model('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000002','{"provider":"anthropic","model":"claude-opus-4-6"}')$$,'P0002',null,'not in someone else''s Conversation');
select throws_ok($$select public.set_conversation_model('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001','{"provider":"anthropic"}')$$,'22023',null,'a choice names a provider and a model');
select throws_ok($$select public.set_conversation_model('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001','{"provider":"anthropic","model":"claude","price":1}')$$,'22023',null,'and nothing else');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.set_conversation_model('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000002','{"provider":"anthropic","model":"claude-opus-4-6"}')$$,'42501',null,'a Manager''s choice is refused');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.set_conversation_model('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000003','{"provider":"anthropic","model":"claude-opus-4-6"}')$$,'42501',null,'a Contributor''s too');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.set_conversation_model('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000004','{"provider":"anthropic","model":"claude-opus-4-6"}')$$,'42501',null,'and a Viewer''s');
reset role;
select is((select count(*)::int from public.conversations where model is not null),1,'nothing but the Owner''s choice was kept');

-- Each Run is pinned with the Conversation's model at its first start; a Run the Engine refused it for puts the
-- Conversation back on its earlier model.
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
 select ('e9000000-0000-0000-0000-00000000000'||c)::uuid,('ea000000-0000-0000-0000-00000000000'||c)::uuid,'10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000002','Draft the offer email','model-test' from unnest(array[1,9]) c;
select public.pinned_run_note(('e9000000-0000-0000-0000-00000000000'||c)::uuid,('ea000000-0000-0000-0000-00000000000'||c)::uuid,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001') from unnest(array[1,9]) c;
set local role service_role;
select is(public.pin_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000001'),current_setting('test.pick')::jsonb,'a Run of that Conversation carries the choice');
select is(public.pin_run_model('e9000000-0000-0000-0000-000000000009','ea000000-0000-0000-0000-000000000009'),'null'::jsonb,'a Run of the other carries none');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.set_conversation_model('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001','{"provider":"anthropic","model":"claude-opus-4-6"}');
reset role;
set local role service_role;
select is(public.pin_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000001'),current_setting('test.pick')::jsonb,'a Run keeps what it was first pinned with');
select public.refuse_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000001');
reset role;
select is((select model from public.conversations where id='e9000000-0000-0000-0000-000000000001'),'{"provider":"anthropic","model":"claude-opus-4-6"}'::jsonb,'a refusal of an older choice leaves the newer one');
set local role service_role;
select is(public.refuse_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000001'),false,'and says nothing changed');
reset role;
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile) values
 ('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000002','Draft the offer email','model-test');
select public.pinned_run_note('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
set local role service_role;
select public.pin_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000002');
select is(public.refuse_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000002'),true,'the Engine refused the newest choice');
reset role;
select is((select model_refused from public.conversation_queued_turns where conversation_id='e9000000-0000-0000-0000-000000000001' and send_key='ea000000-0000-0000-0000-000000000002'),true,'the waiting turn it was is marked refused for its model, for its sender''s page');
select is((select model_refused from public.conversation_queued_turns where conversation_id='e9000000-0000-0000-0000-000000000001' and send_key='ea000000-0000-0000-0000-000000000001'),false,'a turn refused when nothing changed is not');
select is((select model from public.conversations where id='e9000000-0000-0000-0000-000000000001'),current_setting('test.pick')::jsonb,'the Conversation is back on its earlier model');
set local role service_role;
select is(public.pin_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000002'),current_setting('test.pick')::jsonb,'and the same message sent again carries that one');
reset role;
set local role authenticated;
select throws_ok($$select public.pin_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000001')$$,'42501',null,'only the worker pins');
reset role;
select * from finish();
rollback;
