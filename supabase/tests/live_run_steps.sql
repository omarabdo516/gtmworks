begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
-- #646. RS Learning's seeded Members: the Owner (1), the Manager (2), a Contributor (3) and the Viewer (4). Lead is the
-- main Agent, seen by everyone; Hidden is shown to nobody but the Owner. The general channel is 69000000-...-0001.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6460000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f6460000-0000-0000-0000-000000000001','Live','General',false,'live-steps-test'),
 ('a6460000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f6460000-0000-0000-0000-000000000002','Hidden','Secret',false,'live-steps-test');
insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'a6460000-0000-0000-0000-000000000001'
 from public.members where company_id='10000000-0000-0000-0000-000000000001' and removed_at is null and role<>'owner';
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c6460000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a6460000-0000-0000-0000-000000000001','Live');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c6460000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000003','Sara','Plan the week',gen_random_uuid(),'live-run-1');
set local session_replication_role=replica;
insert into public.channel_messages(id,company_id,channel_id,author,person_id,author_name,body,send_key) overriding system value values
 (-6461,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','Sara','@Live @Hidden go',gen_random_uuid());
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,attempts,run_id,profile) values
 (-6461,1,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','a6460000-0000-0000-0000-000000000001','Live',gen_random_uuid(),'go',0,null,'live-steps-test'),
 (-6461,2,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','a6460000-0000-0000-0000-000000000002','Hidden',gen_random_uuid(),'go',1,'live-channel-2','live-steps-test');
set local session_replication_role=origin;
set local role authenticated;

-- A Conversation's: its own person reads the Run it waits on, and its profile; nobody else does.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select run||' '||profile from public.conversation_live_run('c6460000-0000-0000-0000-000000000003')),'live-run-1 live-steps-test','the chat''s own person reads its open Run');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.conversation_live_run('c6460000-0000-0000-0000-000000000003')),0,'the Owner reads no other person''s chat');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.conversation_live_run('c6460000-0000-0000-0000-000000000003')),0,'nor does a Manager');
-- Once the reply is in, nothing is working.
reset role;
insert into public.conversation_messages(company_id,conversation_id,author,author_name,body,run_id) values
 ('10000000-0000-0000-0000-000000000001','c6460000-0000-0000-0000-000000000003','agent','Live','Here is the week.','live-run-1');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.conversation_live_run('c6460000-0000-0000-0000-000000000003')),0,'a Run that replied is no longer working');
-- A chat whose Agent the person no longer sees is not theirs to read.
reset role;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c6460000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000003','Sara','And next week',gen_random_uuid(),'live-run-2');
set local role authenticated;
select is((select run from public.conversation_live_run('c6460000-0000-0000-0000-000000000003')),'live-run-2','the next Run is the one working');
reset role;
delete from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000003' and agent_id='a6460000-0000-0000-0000-000000000001';
set local role authenticated;
select is((select count(*)::int from public.conversation_live_run('c6460000-0000-0000-0000-000000000003')),0,'once its Agent is hidden from them, its person reads none');
reset role;
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a6460000-0000-0000-0000-000000000001');
set local role authenticated;

-- A channel's: the Run worked on now is the message's first open place; one not yet started has none, and the second
-- Agent's Run, waiting its turn, is not taken for it.
select is((select count(*)::int from public.channel_live_run('69000000-0000-0000-0000-000000000001')),0,'a Run whose start has not reached the Engine has none, and the next one is not taken');
reset role;
update public.channel_runs set attempts=1,run_id='live-channel-1' where message_id=-6461 and ordinal=1;
set local role authenticated;
select is((select run||' '||profile from public.channel_live_run('69000000-0000-0000-0000-000000000001')),'live-channel-1 live-steps-test','a Member of the channel reads the Run working now');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select run from public.channel_live_run('69000000-0000-0000-0000-000000000001')),'live-channel-1','a Viewer reads it too, as they read the channel');
-- The second Agent works next, and only a reader who may call it there reads its Run.
reset role;
update public.channel_runs set outcome='completed',closed_at=now() where message_id=-6461 and ordinal=1;
set local role authenticated;
select is((select count(*)::int from public.channel_live_run('69000000-0000-0000-0000-000000000001')),0,'a Member who does not see the Agent at work reads none');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select run from public.channel_live_run('69000000-0000-0000-0000-000000000001')),'live-channel-2','the Owner, who sees it, reads its Run');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000dead',true);
select is((select count(*)::int from public.channel_live_run('69000000-0000-0000-0000-000000000001')),0,'someone outside the Company reads none');

select * from finish();
rollback;
