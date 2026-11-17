begin;
create extension if not exists pgtap with schema extensions;
select plan(21);
-- #141. RS Learning: Omar (1) is Owner, 2 Manager, 3 and 5 Contributors (5 is also in Aleem), 4 Viewer; an outsider is a
-- Member of Aleem only. Each of the five has a Conversation with Ads and in it the message of one run; person 3 has a
-- second, closed run and a third that the follower reads twice.
insert into public.people(id,name) values ('d4100000-0000-0000-0000-0000000000a1','Outsider');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','d4100000-0000-0000-0000-0000000000a1','contributor');
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('d4100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','steps-test','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('d4100000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','d4100000-0000-0000-0000-000000000001','Ads','Ads');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('d4200000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'d4100000-0000-0000-0000-000000000002','Ads' from generate_series(1,5) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('d4200000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone','Plan the December campaign',gen_random_uuid(),'steps-run-'||n from generate_series(1,5) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001','d4200000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000003','Someone','And the ads',gen_random_uuid(),'steps-run-'||n from generate_series(6,7) n;
insert into public.conversation_usage(company_id,conversation_id,run_id,outcome,input_tokens,output_tokens) values ('10000000-0000-0000-0000-000000000001','d4200000-0000-0000-0000-000000000003','steps-run-6','completed',10,2);
select set_config('test.steps','[{"call":"call_1","tool":"web_search","preview":"accounting courses Cairo","state":"done"},{"call":"call_2","tool":"read_file","preview":null,"state":"failed"}]',true);
select set_config('test.other','[{"call":"call_9","tool":"terminal","preview":null,"state":"done"}]',true);

-- The service role keeps what the follower read while each Run is open, then seals it once with the Run's length.
set local role service_role;
select results_eq($$select public.note_run_steps(('d4200000-0000-0000-0000-00000000000'||n)::uuid,'steps-run-'||n,'[{"call":"call_1","tool":"web_search","preview":"accounting courses Cairo","state":"started"}]',3,false) from generate_series(1,5) n$$,
 $$select true from generate_series(1,5)$$,'what the follower read is kept for each open Run');
select results_eq($$select public.seal_run_steps(('d4200000-0000-0000-0000-00000000000'||n)::uuid,'steps-run-'||n,current_setting('test.steps')::jsonb,9,false,41) from generate_series(1,5) n$$,
 $$select true from generate_series(1,5)$$,'each Run''s steps are sealed when it closes');
select results_eq($$select * from public.run_steps_progress('d4200000-0000-0000-0000-000000000003','steps-run-3')$$,
 $$select current_setting('test.steps')::jsonb,9,false,true$$,'the sealed steps are the ones read to the end');

-- A sealed row never changes again; a closed Run and a Run of another Conversation are refused.
select is(public.note_run_steps('d4200000-0000-0000-0000-000000000003','steps-run-3',current_setting('test.other')::jsonb,20,true),false,'a follower late after the seal is refused');
select is(public.seal_run_steps('d4200000-0000-0000-0000-000000000003','steps-run-3',current_setting('test.other')::jsonb,20,true,99),false,'a second closer is refused');
select is(public.note_run_steps('d4200000-0000-0000-0000-000000000003','steps-run-6',current_setting('test.other')::jsonb,1,false),false,'a Run already closed is refused');
select is(public.seal_run_steps('d4200000-0000-0000-0000-000000000003','steps-run-6',current_setting('test.other')::jsonb,1,false,5),false,'and is not sealed either');
select is(public.note_run_steps('d4200000-0000-0000-0000-000000000003','steps-run-1',current_setting('test.other')::jsonb,1,false),false,'a Run of another Conversation is refused');
select is(public.note_run_steps('d4200000-0000-0000-0000-000000000003','steps-run-forged',current_setting('test.other')::jsonb,1,false),false,'a run no message names is refused');

-- A read from an earlier number keeps what was read further, and a loss is never forgotten.
select is(public.note_run_steps('d4200000-0000-0000-0000-000000000003','steps-run-7',current_setting('test.steps')::jsonb,12,true),true,'the follower keeps its read');
select is(public.note_run_steps('d4200000-0000-0000-0000-000000000003','steps-run-7',current_setting('test.other')::jsonb,4,false),true,'a read that went less far is taken');
reset role;
select results_eq($$select run_id,steps,read_to,broken,seconds,sealed_at is not null from public.conversation_run_steps where conversation_id='d4200000-0000-0000-0000-000000000003' order by run_id$$,
 $$values ('steps-run-3',current_setting('test.steps')::jsonb,9,false,41,true),('steps-run-7',current_setting('test.steps')::jsonb,12,true,null::int,false)$$,
 'the sealed row is unchanged, the closed and foreign runs have none, and the earlier read changed nothing');
select throws_ok($$insert into public.conversation_run_steps(company_id,conversation_id,run_id,steps) values ('10000000-0000-0000-0000-000000000001','d4200000-0000-0000-0000-000000000001','steps-run-1x','[{"call":"c","tool":"t","preview":null,"state":"skipped"}]')$$,
 '23514',null,'a step in a state the Engine never reports is refused');

-- Whoever reads the Conversation reads its steps: its own person, whatever their Role, and no one else.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(run_id,',' order by run_id) from public.conversation_run_steps),'steps-run-1','the Owner reads the steps of their own Conversation only, not those of their team');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select string_agg(run_id,',' order by run_id) from public.conversation_run_steps),'steps-run-2','a Manager reads their own');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select string_agg(run_id,',' order by run_id) from public.conversation_run_steps),'steps-run-3,steps-run-7','a Contributor reads their own');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select string_agg(run_id,',' order by run_id) from public.conversation_run_steps),'steps-run-4','a Viewer reads their own');
select set_config('request.jwt.claim.sub','d4100000-0000-0000-0000-0000000000a1',true);
select is((select count(*)::int from public.conversation_run_steps),0,'a Member of another Company reads none');
select throws_ok($$select public.note_run_steps('d4200000-0000-0000-0000-000000000005','steps-run-5','[]',1,false)$$,'42501',null,'a person cannot write steps');
reset role;
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.conversation_run_steps),0,'a person removed from the Company no longer reads the steps of their Conversation there');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.conversation_run_steps$$,'42501',null,'nobody signed out reads any');
reset role;
select * from finish();
rollback;
