begin;
create extension if not exists pgtap with schema extensions;
select plan(27);
-- RS Learning: Omar is Owner, 2 Manager, 3 and 5 Contributors, 4 Viewer. Omar speaks as the company's Owner.
update public.members set role='contributor' where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('e0000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','roles','ciphertext','connected');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('e1000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000011','Mona','Writing',true);
set local role authenticated;

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.send_conversation_message('e2000000-0000-0000-0000-000000000101','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000011','Hello','e3000000-0000-0000-0000-000000000011','run_owner'),true,'an Owner starts a conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.send_conversation_message('e2000000-0000-0000-0000-000000000102','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000011','Hello','e3000000-0000-0000-0000-000000000011','run_manager'),true,'a Manager starts a conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.send_conversation_message('e2000000-0000-0000-0000-000000000103','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000011','Hello','e3000000-0000-0000-0000-000000000011','run_contributor'),true,'a Contributor starts a conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.send_conversation_message('e2000000-0000-0000-0000-000000000104','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000011','Hello','e3000000-0000-0000-0000-000000000011','run_contributor_two'),true,'a second Contributor starts a conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.send_conversation_message('e2000000-0000-0000-0000-000000000105','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000011','Hello','e3000000-0000-0000-0000-000000000011','run_viewer')$$,'42501','conversationNotAllowed','a Viewer cannot start a conversation');

-- A Contributor keeps writing in their own conversation; only the server (close_conversation_run) stores its reply.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(public.conversation_agent('e2000000-0000-0000-0000-000000000103','10000000-0000-0000-0000-000000000001'),'e1000000-0000-0000-0000-000000000011'::uuid,'a Contributor reaches the agent of their conversation');
select is(public.send_conversation_message('e2000000-0000-0000-0000-000000000103','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000011','More','e3000000-0000-0000-0000-000000000012','run_2'),true,'a Contributor posts to their conversation');
select throws_ok($$select public.record_conversation_run('e2000000-0000-0000-0000-000000000103','run_2','completed','Forged','session_1',10,2)$$,'42501','conversationNotAllowed','a Contributor cannot write a reply or usage');
select throws_ok($$select public.record_conversation_reply('e2000000-0000-0000-0000-000000000103','run_2','Forged','session_1')$$,'42501','conversationNotAllowed','a Contributor cannot write a reply');
select is((select count(*)::int from public.conversation_messages where conversation_id='e2000000-0000-0000-0000-000000000103'),2,'two messages and no reply');
select throws_ok($$select public.conversation_agent('e2000000-0000-0000-0000-000000000101','10000000-0000-0000-0000-000000000001')$$,'P0002','conversationNotFound','a Contributor cannot reach the Owner''s conversation');
select throws_ok($$select public.send_conversation_message('e2000000-0000-0000-0000-000000000101','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000011','Mine now','e3000000-0000-0000-0000-000000000013','run_3')$$,'P0002','conversationNotFound','a Contributor cannot post to the Owner''s conversation');
-- A run belongs to one conversation: registering it again elsewhere would count its engine usage twice.
select throws_ok($$select public.send_conversation_message('e2000000-0000-0000-0000-000000000106','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000011','Copy','e3000000-0000-0000-0000-000000000016','run_2')$$,'P0002','conversationNotFound','a Contributor cannot register their run under another conversation');
select is((select count(*)::int from public.conversations where id='e2000000-0000-0000-0000-000000000106'),0,'and no conversation is left for it');
select is(public.send_conversation_message('e2000000-0000-0000-0000-000000000103','10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000011','More','e3000000-0000-0000-0000-000000000012','run_2'),false,'a retry in the same conversation stores nothing more');

-- A Viewer reaches no agent, even of a conversation whose id they know, and reads no conversation of another Member.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.conversation_agent('e2000000-0000-0000-0000-000000000103','10000000-0000-0000-0000-000000000001')$$,'42501','conversationNotAllowed','a Viewer reaches no agent');
select is((select count(*)::int from public.conversations),0,'a Viewer sees no conversation of another Member');
-- A Member of one company cannot write in a company they are not a member of.
select throws_ok($$select public.send_conversation_message('e2000000-0000-0000-0000-000000000109','10000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000011','Hi','e3000000-0000-0000-0000-000000000019','run_9')$$,'42501','conversationNotAllowed','a non-member cannot write in another company');

-- Each Member, the Owner included, reads only their own conversation and its messages and usage.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(id::text,',') from public.conversations),'e2000000-0000-0000-0000-000000000101','the Owner reads only their own conversation');
select is((select count(*)::int from public.conversation_messages where conversation_id<>'e2000000-0000-0000-0000-000000000101'),0,'the Owner reads no message of another Member');
select is((select count(*)::int from public.conversation_usage),0,'the Owner reads no usage of another Member''s conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select string_agg(id::text,',') from public.conversations),'e2000000-0000-0000-0000-000000000102','a Manager reads only their own conversation');
select is((select count(*)::int from public.conversation_messages where conversation_id<>'e2000000-0000-0000-0000-000000000102'),0,'a Manager reads no message of another Member');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.conversation_messages where conversation_id<>'e2000000-0000-0000-0000-000000000104'),0,'a second Contributor reads no message of another Member');

-- The worker reads a Contributor's open run with the agent's Connection, whoever owns that Connection.
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select string_agg(run||':'||person||':'||connection,',' order by run) from public.open_conversation_runs('e2000000-0000-0000-0000-000000000103','20000000-0000-0000-0000-000000000005')),'run_2:20000000-0000-0000-0000-000000000005:e0000000-0000-0000-0000-000000000011,run_contributor:20000000-0000-0000-0000-000000000005:e0000000-0000-0000-0000-000000000011','a Contributor''s open runs come with the agent''s Connection');
select is((select connection_id from public.hermes_agents where id='e1000000-0000-0000-0000-000000000011' and company_id='10000000-0000-0000-0000-000000000001'),'e0000000-0000-0000-0000-000000000011'::uuid,'the server reads which Connection the company''s agent uses');
select is((select address||':'||profile||':'||state||':'||key_encrypted from public.hermes_connections where id='e0000000-0000-0000-0000-000000000011'),'http://localhost:roles:connected:ciphertext','the server reads the agent''s Connection for a Member''s message');
select * from finish();
rollback;
