begin;
create extension if not exists pgtap with schema extensions;
select plan(65);
-- An install from before #120: RS Learning (1) has Lead, its main Agent, on the Company's own profile, and Aleem (3) has
-- its Lead and Copy on Aleem's. Aleem's profile is not ready yet. Every message so far is an hour old.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('b1000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','co-10000000000000000000000000000001','ciphertext','connected','0.23.0','{run_submission}'),
 ('b1000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','co-10000000000000000000000000000003','ciphertext-3','connected','0.23.0','{run_submission}'),
 ('b1000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','co-10000000000000000000000000000003','ciphertext-3','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('b1100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','Lead','General',true),
 ('b1100000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000003','Lead','General',true),
 ('b1100000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000004','Copy','Writes',false);
insert into public.hermes_agent_audit(company_id,actor_id,agent_id,action,details) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','b1100000-0000-0000-0000-000000000001','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','b1000000-0000-0000-0000-000000000001')),
 ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','b1100000-0000-0000-0000-000000000003','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','b1000000-0000-0000-0000-000000000003')),
 ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','b1100000-0000-0000-0000-000000000004','REQUEST_HERMES_AGENT',jsonb_build_object('connection_id','b1000000-0000-0000-0000-000000000004'));
insert into public.company_profiles(company_id,profile,tools_level,tools_policy) values ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy());
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('b1200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','b1100000-0000-0000-0000-000000000001','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
 ('10000000-0000-0000-0000-000000000001','b1200000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','I want a writer and someone for our ads',gen_random_uuid(),'run-1',now()-interval '1 hour'),
 ('10000000-0000-0000-0000-000000000001','b1200000-0000-0000-0000-000000000001','agent',null,'Lead','Both are on the team.',null,'run-1',now()-interval '1 hour');
create temporary table named(name text primary key, agent uuid);
grant select on named to authenticated;
grant all on named to service_role;
set local role service_role;
-- The previous app version's call, as Lead and «Make it» made Agents before #120: on Lead's profile.
insert into named select 'writer',(public.lead_create_agent('b1200000-0000-0000-0000-000000000001','run-1','call-1','Writer','Writes the blog.','{}')->>'agent')::uuid;
insert into named select 'ads',(public.lead_create_agent('b1200000-0000-0000-0000-000000000001','run-1','call-2','Ads','Runs the ads.','{}')->>'agent')::uuid;
reset role;
insert into named values ('lead','b1100000-0000-0000-0000-000000000001'),('copy','b1100000-0000-0000-0000-000000000004');
create temporary table aleem as select a.id,a.connection_id,h.profile,h.key_encrypted from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.company_id='10000000-0000-0000-0000-000000000003';
create temporary table writer_before as select h.* from public.hermes_connections h join public.hermes_agents a on a.connection_id=h.id join named n on n.agent=a.id and n.name='writer';
select ok((select bool_and(h.profile='co-10000000000000000000000000000001') from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.company_id='10000000-0000-0000-0000-000000000001'),
 'every Agent of RS Learning runs on the Company''s profile');

set local role service_role;
select results_eq($$select agent_id,profile,agent_level::int,recorded from public.agent_move_work() order by agent_id$$,
 $$select agent,'ag-'||replace(agent::text,'-',''),1,false from named where name in ('writer','ads') order by agent$$,
 'each Agent on the Company''s profile but the main one is listed to move to its own, with the Company''s level; Aleem''s wait for its profile');
select is(public.begin_agent_profile_move((select agent from named where name='lead')),false,'the main Agent never begins a move');
reset role;
select is((select agent_id from public.company_profile_keepers where company_id='10000000-0000-0000-0000-000000000001'),(select agent from named where name='lead'),
 'it is recorded as the keeper of the Company''s profile');
select is((select count(*)::int from public.agent_profiles),0,'and gets no owner record');
set local role service_role;
select ok(public.begin_agent_profile_move((select agent from named where name='writer')),'the Writer begins its move');
select ok(public.begin_agent_profile_move((select agent from named where name='writer')),'and beginning again changes nothing');
reset role;
select results_eq($$select agent_id,company_id,tools_level from public.agent_profiles$$,
 $$select agent,'10000000-0000-0000-0000-000000000001'::uuid,null::smallint from named where name='writer'$$,'one owner record, with no tools yet');
set local role service_role;
select is(public.move_agent_profile((select agent from named where name='writer')),false,'it does not move before its profile''s tools are read back and recorded');
select ok((select recorded from public.agent_move_work() where agent_id=(select agent from named where name='writer')),'the worker reads that its record exists');
select public.record_agent_profile(agent,'ag-'||replace(agent::text,'-',''),1,public.engine_tool_policy()) from named where name='writer';
reset role;

-- Each blocker alone, with nothing else in flight: the move is refused and the Agent is off the worker's list; once it
-- ends, or the clock passes its window, the Agent is back on the list.
create function pg_temp.listed() returns boolean language sql as $$ select exists(select 1 from public.agent_move_work() where agent_id=(select agent from named where name='writer')) $$;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) select 'b1200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',agent,'Writer' from named where name='writer';
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
 ('10000000-0000-0000-0000-000000000001','b1200000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000001','Omar','Write the first post',gen_random_uuid(),'w-1',now()-interval '10 minutes');
select is(public.move_agent_profile((select agent from named where name='writer')),false,'an open Run in one of its Conversations holds the move, ten minutes after its message');
select ok(not pg_temp.listed(),'and keeps it off the list');
insert into public.conversation_usage(company_id,conversation_id,run_id,outcome) values ('10000000-0000-0000-0000-000000000001','b1200000-0000-0000-0000-000000000002','w-1','failed');
select ok(pg_temp.listed(),'once that Run has ended it may move');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
 ('10000000-0000-0000-0000-000000000001','b1200000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000001','Omar','Shorter, please',gen_random_uuid(),'w-2',now()-interval '4 minutes'),
 ('10000000-0000-0000-0000-000000000001','b1200000-0000-0000-0000-000000000002','agent',null,'Writer','Here it is, shorter.',null,'w-2',now()-interval '4 minutes');
select is(public.move_agent_profile((select agent from named where name='writer')),false,'a message in its Conversations in the last five minutes holds the move');
select ok(not pg_temp.listed(),'and keeps it off the list');
set local session_replication_role=replica;
update public.conversation_messages set created_at=now()-interval '6 minutes' where conversation_id='b1200000-0000-0000-0000-000000000002' and run_id='w-2';
set local session_replication_role=origin;
select ok(pg_temp.listed(),'five minutes after it, it may move');
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile,created_at)
 select 'b1200000-0000-0000-0000-000000000002','b1300000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',h.id,'20000000-0000-0000-0000-000000000001',n.agent,'Another one',h.profile,now()-interval '20 minutes'
 from named n join public.hermes_agents a on a.id=n.agent join public.hermes_connections h on h.id=a.connection_id where n.name='writer';
select is(public.move_agent_profile((select agent from named where name='writer')),false,'a Run reserved for it holds the move');
select ok(not pg_temp.listed(),'and keeps it off the list');
update public.conversation_run_reservations set abandoned_at=now() where send_key='b1300000-0000-0000-0000-000000000001';
select ok(pg_temp.listed(),'an abandoned reservation holds nothing');
set local session_replication_role=replica;
insert into public.channel_messages(id,company_id,channel_id,author,person_id,author_name,body,send_key) overriding system value values
 (-11,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','@Writer hello',gen_random_uuid());
insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input,created_at)
 select -11,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',agent,'Writer',gen_random_uuid(),'Omar: hello',now()-interval '20 minutes' from named where name='writer';
insert into public.work_comments(id,company_id,card_id,body,author_id) overriding system value values (-11,'10000000-0000-0000-0000-000000000001',-1,'@Writer hello','20000000-0000-0000-0000-000000000001');
set local session_replication_role=origin;
select is(public.move_agent_profile((select agent from named where name='writer')),false,'an open channel Run of it holds the move');
select ok(not pg_temp.listed(),'and keeps it off the list');
update public.channel_runs set outcome='failed',closed_at=now() where message_id=-11;
select ok(pg_temp.listed(),'once the channel Run has ended it may move');
set local session_replication_role=replica;
insert into public.note_runs(note_id,company_id,card_id,agent_id,agent_name,session,input,created_at)
 select -11,'10000000-0000-0000-0000-000000000001',-1,agent,'Writer',gen_random_uuid(),'Omar: hello',now()-interval '20 minutes' from named where name='writer';
set local session_replication_role=origin;
select is(public.move_agent_profile((select agent from named where name='writer')),false,'an open note Run of it holds the move');
select ok(not pg_temp.listed(),'and keeps it off the list');
update public.note_runs set outcome='failed',closed_at=now() where note_id=-11;
select ok(pg_temp.listed(),'once the note Run has ended it may move');

set local role service_role;
select ok(public.move_agent_profile((select agent from named where name='writer')),'with nothing in flight and its tools recorded, the Writer moves');
select is(public.move_agent_profile((select agent from named where name='writer')),false,'moving it again does nothing');
reset role;
select ok(exists(select 1 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id join named n on n.agent=a.id and n.name='writer', writer_before w
  where h.profile=public.agent_engine_profile(n.agent) and h.company_id=w.company_id and h.owner_id=w.owner_id and h.address=w.address and h.key_encrypted=w.key_encrypted
   and h.state=w.state and h.version=w.version and h.features=w.features and public.is_bundled_connection(h.id)),
 'its new Connection names its own profile, with the old one''s address, key, owner, version and features, and is the worker''s kind');
select ok(not exists(select 1 from public.hermes_connections h join writer_before w on w.id=h.id),'its old Connection is removed');
select results_eq($$select a.connection_id,h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id='b1100000-0000-0000-0000-000000000001'$$,
 $$values ('b1000000-0000-0000-0000-000000000001'::uuid,'co-10000000000000000000000000000001')$$,'Lead keeps its Connection to the Company''s profile, untouched');
select ok(not pg_temp.listed(),'the Writer is off the list');
select results_eq($$select actor_id,action,details->>'agent_name' from public.company_log where agent_id=(select agent from named where name='writer') and action='agent_own_space'$$,
 $$values ('20000000-0000-0000-0000-000000000001'::uuid,'agent_own_space','Writer')$$,'its move is one row of the Company''s log, in the first Owner''s name as the Company''s move is');

-- The log row is read by each Member who sees the Writer: the Owner, and the Manager, Contributor and Viewer it is shown to.
insert into public.member_agent_access(company_id,person_id,agent_id) select '10000000-0000-0000-0000-000000000001',p,agent from named,
 unnest(array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[]) p where name='writer';
create temporary table readers(person uuid, sees integer);
grant all on readers to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into readers select auth.uid(),count(*) from public.company_log where action='agent_own_space';
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into readers select auth.uid(),count(*) from public.company_log where action='agent_own_space';
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into readers select auth.uid(),count(*) from public.company_log where action='agent_own_space';
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into readers select auth.uid(),count(*) from public.company_log where action='agent_own_space';
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into readers select auth.uid(),count(*) from public.company_log where action='agent_own_space';
reset role;
select results_eq($$select right(person::text,1),sees from readers order by person$$,$$values ('1',1),('2',1),('3',1),('4',1),('5',0)$$,
 'the Owner, Manager, Contributor and Viewer who see the Writer read its row; a Contributor it is not shown to does not');

-- Every Run of a Conversation that began before the Writer moved carries the record as history, its retry the same, and
-- a later Run the record with what was said since; a Conversation begun after the move carries none.
create temporary table sent(name text primary key, result jsonb);
grant all on sent to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into sent select 'next',public.reserve_conversation_turn('b1200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',agent,'b1300000-0000-0000-0000-000000000002','Next draft') from named where name='writer';
insert into sent select 'lead',public.reserve_conversation_turn('b1200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',agent,'b1300000-0000-0000-0000-000000000003','Anything new?') from named where name='lead';
reset role;
select is((select result->>'connection' from sent where name='next'),(select a.connection_id::text from public.hermes_agents a join named n on n.agent=a.id and n.name='writer'),
 'the Writer''s next Run is reserved on its own profile');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.pin_run_history('b1200000-0000-0000-0000-000000000002','b1300000-0000-0000-0000-000000000002'),
 '[{"role":"user","content":"Write the first post"},{"role":"user","content":"Shorter, please"},{"role":"assistant","content":"Here it is, shorter."}]'::jsonb,
 'its first Run after the move carries every message of the Conversation, in order, as history');
select is(public.begin_start('b1200000-0000-0000-0000-000000000002','b1300000-0000-0000-0000-000000000002'),1,'its start is begun');
select is(public.pin_run_history('b1200000-0000-0000-0000-000000000002','b1300000-0000-0000-0000-000000000002'),
 '[{"role":"user","content":"Write the first post"},{"role":"user","content":"Shorter, please"},{"role":"assistant","content":"Here it is, shorter."}]'::jsonb,
 'and a retry of that start carries the same history');
select is(public.pin_run_history('b1200000-0000-0000-0000-000000000001','b1300000-0000-0000-0000-000000000003'),null,'a Run of Lead, on the Company''s profile, carries none');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select ok(public.send_conversation_message('b1200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',agent,'Next draft','b1300000-0000-0000-0000-000000000002','w-3',
 (select a.connection_id from public.hermes_agents a where a.id=agent)) ,'the Run is recorded') from named where name='writer';
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select ok(public.close_conversation_run('b1200000-0000-0000-0000-000000000002','w-3','completed','The next draft.',null,10,5),'and answered');
reset role;
select is((select string_agg(author||':'||body,' | ' order by id) from public.conversation_messages where conversation_id='b1200000-0000-0000-0000-000000000002'),
 'person:Write the first post | person:Shorter, please | agent:Here it is, shorter. | person:Next draft | agent:The next draft.','the Conversation keeps every message of its record');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
insert into sent select 'later',public.reserve_conversation_turn('b1200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',agent,'b1300000-0000-0000-0000-000000000004','And another') from named where name='writer';
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.pin_run_history('b1200000-0000-0000-0000-000000000002','b1300000-0000-0000-0000-000000000004'),
 '[{"role":"user","content":"Write the first post"},{"role":"user","content":"Shorter, please"},{"role":"assistant","content":"Here it is, shorter."},{"role":"user","content":"Next draft"},{"role":"assistant","content":"The next draft."}]'::jsonb,
 'a later Run carries the whole record again: the Engine never saves a given history into the session');
reset role;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) select 'b1200000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',agent,'Writer' from named where name='writer';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
insert into sent select 'fresh',public.reserve_conversation_turn('b1200000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001',agent,'b1300000-0000-0000-0000-000000000009','A new topic') from named where name='writer';
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.pin_run_history('b1200000-0000-0000-0000-000000000009','b1300000-0000-0000-0000-000000000009'),null,
 'a Conversation begun after the move carries none: its session is in the Agent''s own profile');
reset role;

-- The newest messages are kept within 6,000,000 bytes: of 31 messages of 200,000 characters, the 29 newest.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) select 'b1200000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',agent,'Writer' from named where name='writer';
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at)
 select '10000000-0000-0000-0000-000000000001','b1200000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000001','Omar',lpad(n::text,200000,'x'),gen_random_uuid(),'b-'||n,now()-interval '2 hours'+n*interval '1 second'
 from generate_series(1,31) n;
insert into public.conversation_usage(company_id,conversation_id,run_id,outcome) select '10000000-0000-0000-0000-000000000001','b1200000-0000-0000-0000-000000000003','b-'||n,'failed' from generate_series(1,31) n;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
insert into sent select 'long',public.reserve_conversation_turn('b1200000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',agent,'b1300000-0000-0000-0000-000000000005','Sum it up') from named where name='writer';
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into sent select 'long history',public.pin_run_history('b1200000-0000-0000-0000-000000000003','b1300000-0000-0000-0000-000000000005');
reset role;
select results_eq($$select jsonb_array_length(result),ltrim(result->0->>'content','x'),ltrim(result->28->>'content','x'),octet_length(result::text)<=6000000+2*29 from sent where name='long history'$$,
 $$values (29,'3','31',true)$$,'a long Conversation carries its 29 newest messages, within the budget');

-- The Owner makes the moved Writer the main Agent: no Agent's profile changes, Lead stays the keeper and is never listed,
-- and Lead's tools follow the main Agent on its own profile, for the Owner only.
create temporary table profiles_before as select a.id,a.connection_id,h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.company_id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','default',null,(select agent from named where name='writer'))$$,'the Owner makes the Writer the main Agent');
reset role;
select results_eq($$select a.id,a.connection_id,h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.company_id='10000000-0000-0000-0000-000000000001' order by a.id$$,
 $$select * from profiles_before order by id$$,'no Agent''s profile changes hands');
select is((select agent_id from public.company_profile_keepers where company_id='10000000-0000-0000-0000-000000000001'),(select agent from named where name='lead'),'Lead stays the keeper');
select ok(not exists(select 1 from public.agent_move_work() where agent_id=(select agent from named where name='lead')),'and is never listed to move');
select results_eq($$select right(p::text,1),a.name,'create_agent'=any(public.run_tools('10000000-0000-0000-0000-000000000001',a.agent,p)) from named a,
  unnest(array['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[]) p
  where a.name in ('writer','lead') order by a.name desc,p$$,
 $$values ('1','writer',true),('2','writer',false),('3','writer',false),('4','writer',false),('1','lead',false),('2','lead',false),('3','lead',false),('4','lead',false)$$,
 'a Run offers create_agent to the Owner talking to the new main Agent, and to nobody else');

-- An Agent the new main Agent makes without a profile of its own lands on the Company's profile, as does the one made on
-- Lead's profile before: the worker moves both.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) select 'b1200000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',agent,'Writer' from named where name='writer';
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values
 ('10000000-0000-0000-0000-000000000001','b1200000-0000-0000-0000-000000000004','person','20000000-0000-0000-0000-000000000001','Omar','I want someone for search',gen_random_uuid(),'l-1',now()-interval '1 hour'),
 ('10000000-0000-0000-0000-000000000001','b1200000-0000-0000-0000-000000000004','agent',null,'Writer','Done.',null,'l-1',now()-interval '1 hour');
set local role service_role;
insert into named select 'seo',(public.lead_create_agent('b1200000-0000-0000-0000-000000000004','l-1','call-1','SEO','Writes for search.','{}')->>'agent')::uuid;
reset role;
select is((select h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id join named n on n.agent=a.id and n.name='seo'),'co-10000000000000000000000000000001',
 'the main Agent''s fallback puts the new Agent on the Company''s profile');
set local role service_role;
select results_eq($$select agent_id from public.agent_move_work() order by agent_id$$,$$select agent from named where name in ('ads','seo') order by agent$$,
 'it is listed to move, beside the Agent made on Lead''s profile');
select results_eq($$select public.begin_agent_profile_move(agent) from named where name in ('ads','seo') order by name$$,$$values (true),(true)$$,'both begin their move');
select public.record_agent_profile(agent,'ag-'||replace(agent::text,'-',''),1,public.engine_tool_policy()) from named where name in ('ads','seo');
select results_eq($$select public.move_agent_profile(agent) from named where name in ('ads','seo') order by name$$,$$values (true),(true)$$,'and both move');
reset role;
select is((select string_agg(n.name||'='||(h.profile=public.agent_engine_profile(a.id))::text,',' order by n.name) from named n join public.hermes_agents a on a.id=n.agent join public.hermes_connections h on h.id=a.connection_id),
 'ads=true,copy=false,lead=false,seo=true,writer=true','every Agent of RS Learning but Lead is on its own profile');
select is((select h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id='b1100000-0000-0000-0000-000000000001'),'co-10000000000000000000000000000001',
 'and Lead still on the Company''s');
select lives_ok($$set constraints all immediate$$,'every owner record belongs to its Agent');

-- Isolation: RS Learning's moves left Aleem as it was; Aleem's own move touches only Aleem.
select results_eq($$select a.id,a.connection_id,h.profile,h.key_encrypted from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.company_id='10000000-0000-0000-0000-000000000003' order by a.id$$,
 $$select * from aleem order by id$$,'RS Learning''s moves leave Aleem''s Agents and Connections as they were');
select ok(not exists(select 1 from public.company_profile_keepers where company_id='10000000-0000-0000-0000-000000000003')
  and not exists(select 1 from public.agent_profiles where company_id='10000000-0000-0000-0000-000000000003'),'and record no keeper or owner record for Aleem');
create temporary table rs_after as select a.id,a.connection_id,h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.company_id='10000000-0000-0000-0000-000000000001';
insert into public.company_profiles(company_id,profile,tools_level,tools_policy) values ('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003',1,public.engine_tool_policy());
set local role service_role;
select results_eq($$select agent_id,company_id from public.agent_move_work()$$,$$values ('b1100000-0000-0000-0000-000000000004'::uuid,'10000000-0000-0000-0000-000000000003'::uuid)$$,
 'once Aleem''s profile is ready, its Copy is listed, under Aleem');
select ok(public.begin_agent_profile_move('b1100000-0000-0000-0000-000000000004'),'Copy begins its move');
select public.record_agent_profile('b1100000-0000-0000-0000-000000000004','ag-b1100000000000000000000000000004',1,public.engine_tool_policy());
select ok(public.move_agent_profile('b1100000-0000-0000-0000-000000000004'),'and moves');
reset role;
select is((select agent_id from public.company_profile_keepers where company_id='10000000-0000-0000-0000-000000000003'),'b1100000-0000-0000-0000-000000000003'::uuid,'Aleem''s keeper is Aleem''s Lead');
select ok(exists(select 1 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id='b1100000-0000-0000-0000-000000000004'
  and h.company_id='10000000-0000-0000-0000-000000000003' and h.key_encrypted='ciphertext-3' and h.profile=public.agent_engine_profile(a.id)),'Copy''s new Connection is Aleem''s, with Aleem''s key');
select results_eq($$select a.id,a.connection_id,h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.company_id='10000000-0000-0000-0000-000000000001' order by a.id$$,
 $$select * from rs_after order by id$$,'Aleem''s move leaves RS Learning as it was');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.company_log where agent_id='b1100000-0000-0000-0000-000000000004'),0,'RS Learning''s Manager reads nothing of Aleem''s move');
reset role;
select * from finish();
rollback;
