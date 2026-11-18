begin;
create extension if not exists pgtap with schema extensions;
select plan(41);
-- #158. Ads in RS Learning, shown to every Member; one Conversation with Ads each for the Owner (1), the Manager (2), a
-- Contributor (3) and the Viewer (4), and a second one for the Owner.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('e8000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001','Ads','Ads','model-test');
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
-- A waiting turn the Engine refused for its model is settled in one call with its attempt (refuse_run_model with three
-- arguments): the revert, the turn's mark and its failure commit together, and only while that attempt is the latest.
insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message) values
 ('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000002','Draft the offer email');
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile) values
 ('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000002','Draft the offer email','model-test');
select public.pinned_run_note('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.set_conversation_model('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001','{"provider":"anthropic","model":"claude-opus-4-6"}');
reset role;
set local role service_role;
select public.pin_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000003');
select public.begin_start('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000003');
select public.begin_start('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000003');
select is(public.refuse_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000003',1),false,'a refusal of an attempt a newer one followed changes nothing');
select is(public.pin_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000003'),'{"provider":"anthropic","model":"claude-opus-4-6"}'::jsonb,'the newer attempt keeps the model it was pinned with');
reset role;
select is((select model from public.conversations where id='e9000000-0000-0000-0000-000000000001'),'{"provider":"anthropic","model":"claude-opus-4-6"}'::jsonb,'and the Conversation keeps its model');
select is((select (failed_at is null) and not model_refused from public.conversation_queued_turns where conversation_id='e9000000-0000-0000-0000-000000000001' and send_key='ea000000-0000-0000-0000-000000000003'),true,'and the turn is neither failed nor marked');
set local role service_role;
select is(public.refuse_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000003',2),true,'the refusal of the latest attempt is told');
reset role;
select is((select model from public.conversations where id='e9000000-0000-0000-0000-000000000001'),current_setting('test.pick')::jsonb,'it puts the Conversation back on its earlier model');
select is((select model_refused from public.conversation_queued_turns where conversation_id='e9000000-0000-0000-0000-000000000001' and send_key='ea000000-0000-0000-0000-000000000003'),true,'marks the turn refused for its model');
select isnt((select failed_at from public.conversation_queued_turns where conversation_id='e9000000-0000-0000-0000-000000000001' and send_key='ea000000-0000-0000-0000-000000000003'),null,'and fails it in the same call, so it never starts again');
select is((select count(*)::int from public.conversation_run_reservations where conversation_id='e9000000-0000-0000-0000-000000000001' and send_key='ea000000-0000-0000-0000-000000000003'),0,'with its reservation released');
-- A Run sent straight away that the Engine refused for its model is released and refused in one call by its sender
-- (refuse_conversation_run_model), only while the attempt it names is the reservation's latest (review of #330).
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile) values
 ('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000002','Draft the offer email','model-test');
select public.pinned_run_note('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.set_conversation_model('10000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001','{"provider":"anthropic","model":"claude-opus-4-6"}');
reset role;
set local role service_role;
select public.pin_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000004');
select public.begin_start('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000004');
select public.begin_start('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000004');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.refuse_conversation_run_model('e9000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000004',1),false,'a late refusal of a sent Run''s first attempt, once the second began, changes nothing');
reset role;
set local role service_role;
select is(public.pin_run_model('e9000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000004'),'{"provider":"anthropic","model":"claude-opus-4-6"}'::jsonb,'the second attempt keeps its pinned model');
reset role;
select is((select model from public.conversations where id='e9000000-0000-0000-0000-000000000001'),'{"provider":"anthropic","model":"claude-opus-4-6"}'::jsonb,'the Conversation keeps its model');
select is((select abandoned_at from public.conversation_run_reservations where conversation_id='e9000000-0000-0000-0000-000000000001' and send_key='ea000000-0000-0000-0000-000000000004'),null,'and the reservation stays held');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.refuse_conversation_run_model('e9000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000004',2),false,'another person cannot refuse it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.refuse_conversation_run_model('e9000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','ea000000-0000-0000-0000-000000000004',2),false,'nor through another Company');
select is(public.refuse_conversation_run_model('e9000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000004',2),true,'its sender''s refusal of the latest attempt is told');
reset role;
select is((select model from public.conversations where id='e9000000-0000-0000-0000-000000000001'),current_setting('test.pick')::jsonb,'it puts the Conversation back on its earlier model');
select isnt((select abandoned_at from public.conversation_run_reservations where conversation_id='e9000000-0000-0000-0000-000000000001' and send_key='ea000000-0000-0000-0000-000000000004'),null,'and releases the reservation in the same call');
select ok(has_function_privilege('authenticated','public.refuse_conversation_run_model(uuid,uuid,uuid,integer)','execute'),'the sender calls it');
select ok(not has_function_privilege('anon','public.refuse_conversation_run_model(uuid,uuid,uuid,integer)','execute') and not has_function_privilege('service_role','public.refuse_conversation_run_model(uuid,uuid,uuid,integer)','execute'),'no one else does');
select * from finish();
rollback;
