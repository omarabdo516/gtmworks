begin;
create extension if not exists pgtap with schema extensions;
select plan(71);
-- RS Learning (1): Lead on the Company's own profile, an Owner's (Omar's) and a Manager's Conversation with Lead.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('a7000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','co-10000000000000000000000000000001','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('a7000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001','Lead','General',true);
insert into public.hermes_agent_audit(company_id,actor_id,agent_id,action,details) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000002','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','a7000000-0000-0000-0000-000000000001'));
insert into public.company_profiles(company_id,profile,tools_level,tools_policy) values ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy());
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('a7100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000002','Lead'),
 ('a7100000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a7000000-0000-0000-0000-000000000002','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','a7100000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','I want someone to write our blog',gen_random_uuid(),'run-1'),
 ('10000000-0000-0000-0000-000000000001','a7100000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000002','Manager','I want someone to write our blog',gen_random_uuid(),'run-1');
create temporary table made(name text primary key, agent uuid, profile text);
insert into made values ('own',public.lead_agent_id('a7100000-0000-0000-0000-000000000001','run-1','call-0'),null),('lead',public.lead_agent_id('a7100000-0000-0000-0000-000000000001','run-1','call-1'),null);
update made set profile=public.agent_engine_profile(agent);
grant select on made to authenticated,service_role;

set local role service_role;
select is(public.lead_agent_profile('a7100000-0000-0000-0000-000000000001','run-1','call-0','You write for {company}.'),
 jsonb_build_object('profile',(select profile from made where name='own'),'soul','You write for RS Learning.','level',1),
 'the call names the profile of the Agent it would make, its soul fitted to the Company and the Company''s level');
select is(public.lead_agent_profile('a7100000-0000-0000-0000-000000000002','run-1','call-0','You write for {company}.'),null,'a Manager''s call names none, so the Engine is not asked');
select is(public.lead_create_agent(conversation=>'a7100000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-0',agent_name=>'Writer',job=>'Writes the blog.',apps=>'{WordPress}',
  template=>'writer',instructions=>'You write for {company}.',own_level=>1,own_policy=>2),jsonb_build_object('state','created','agent',(select agent from made where name='own')),
 'the Agent made on its own profile has the id derived from the Conversation, run and call');
select is(public.lead_create_agent(conversation=>'a7100000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-0',agent_name=>'Other',job=>'Other.',apps=>'{}',
  own_level=>1,own_policy=>2),jsonb_build_object('state','created','agent',(select agent from made where name='own')),'the same call again answers the same Agent');
select is(public.lead_agent_profile('a7100000-0000-0000-0000-000000000001','run-1','call-0','You write for {company}.'),
 jsonb_build_object('state','created','agent',(select agent from made where name='own')),'and a repeated call answers the Agent it made, with no profile to make');
reset role;
select is((select tools_pending from public.agent_profiles where agent_id=(select agent from made where name='own')),false,
 'a racing closer that wrote the recorded tools leaves them confirmed');
set local role service_role;
select is(public.lead_create_agent(conversation=>'a7100000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-0',agent_name=>'Writer',job=>'Writes the blog.',apps=>'{WordPress}',
  own_level=>3,own_policy=>2),jsonb_build_object('state','created','agent',(select agent from made where name='own')),'a closer that raced a level change answers the same Agent');
reset role;
select is((select tools_pending from public.agent_profiles where agent_id=(select agent from made where name='own')),true,
 'and the other level''s tools it wrote send the profile back to the worker, so no Run starts on it until its read-back is recorded');
update public.agent_profiles set tools_pending=false where agent_id=(select agent from made where name='own');
select is((select count(*)::int from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001' and not is_default),1,'one Agent is made');
select ok(exists(select 1 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id join made m on m.agent=a.id and m.name='own'
  where h.profile=m.profile and h.key_encrypted='ciphertext' and h.owner_id='20000000-0000-0000-0000-000000000001' and h.address='http://127.0.0.1:9' and public.is_bundled_connection(h.id)
   and a.instructions='You write for RS Learning.' and a.name='Writer'),
 'its Connection names its own profile, with Lead''s address and encrypted key, and its instructions are the soul the profile was given');
select results_eq($$select p.profile,p.company_id,p.tools_level::int,p.tools_policy,p.tools_pending from public.agent_profiles p$$,
 $$select profile,'10000000-0000-0000-0000-000000000001'::uuid,1,2,false from made where name='own'$$,'one owner record, with the level and policy its tools were read back under');
select is((select count(*)::int from public.hermes_connections where profile like 'ag-%'),1,'and one Connection naming the profile');
select lives_ok($$set constraints all immediate$$,'the record written before its Agent belongs to it');
select results_eq($$select actor_id,action,details->>'agent_name',details->>'job' from public.company_log where agent_id=(select agent from made where name='own')$$,
 $$values ('20000000-0000-0000-0000-000000000001'::uuid,'agent_requested','Writer','Writes the blog.')$$,'the log has its one "requested an Agent" row, as before');

set local role service_role;
select is(public.lead_create_agent('a7100000-0000-0000-0000-000000000001','run-1','call-1','SEO','Writes the blog.','{}')->>'agent',(select agent::text from made where name='lead'),
 'the previous app version''s call makes it on Lead''s profile, under the derived id');
select is(public.lead_create_agent(conversation=>'a7100000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-2',agent_name=>'SEO',job=>'Writes.',apps=>'{}',own_level=>1)->>'state','invalid','a level without its policy makes nothing');
select is(public.lead_create_agent(conversation=>'a7100000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-2',agent_name=>'SEO',job=>'Writes.',apps=>'{}',own_level=>4,own_policy=>2)->>'state','invalid','nor a level that does not exist');
reset role;
select ok(exists(select 1 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id join made m on m.agent=a.id and m.name='lead' where h.profile='co-10000000000000000000000000000001'),
 'the Agent on Lead''s profile has a Connection to the Company''s profile');
select is((select count(*)::int from public.agent_profiles),1,'and no owner record');
select is((select count(*)::int from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001'),3,'the refused calls made no Agent');

set local role service_role;
select ok(not exists(select 1 from public.company_profile_work() where company_id='10000000-0000-0000-0000-000000000001' and move),'the Company has no move to make');
select is(public.move_company_profile('10000000-0000-0000-0000-000000000001','http://hermes:8642','encrypted','0.23.0','{run_submission}'),0,'a move moves nothing');
reset role;
select is((select h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=(select agent from made where name='own')),(select profile from made where name='own'),
 'the Agent stays on its own profile');
create temporary table own as select a.id as agent,a.connection_id as connection from public.hermes_agents a join made m on m.agent=a.id and m.name='own';
grant select on own to authenticated,service_role;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000002','attach',(select connection from own),null,'Borrowed','General',false,true)$$,'42501','hermesProfileNotShared',
 'an Owner of two Companies cannot attach it to the other Company''s Agent, even after the sharing warning');
select throws_ok($$insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state) select '10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','http://hermes:8642',profile,'x','connected' from made where name='own'$$,
 '42501','hermesProfileNotShared','nor save a Connection to it in the other Company');
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','attach',(select connection from own),null,'Second','General',false,false)$$,'42501','hermesProfileNotShared',
 'nor attach another Agent to it in its own Company');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','attach',(select connection from own),null,'Second','General',false,true)$$,'42501',null,'a Manager attaches nothing');
select throws_ok($$insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state) select '10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','http://hermes:8642',profile,'x','connected' from made where name='own'$$,
 '42501',null,'nor saves a Connection to it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','attach',(select connection from own),null,'Second','General',false,true)$$,'42501',null,'a Contributor attaches nothing');
select throws_ok($$insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state) select '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','http://hermes:8642',profile,'x','connected' from made where name='own'$$,
 '42501',null,'nor saves a Connection to it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','attach',(select connection from own),null,'Second','General',false,true)$$,'42501',null,'a Viewer attaches nothing');
select throws_ok($$insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state) select '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','http://hermes:8642',profile,'x','connected' from made where name='own'$$,
 '42501',null,'nor saves a Connection to it');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state) select '10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','http://hermes:8642',profile,'x','connected' from made where name='own'$$,
 '42501',null,'the service role saves no Connection to it');
select throws_ok($$insert into public.hermes_agents(company_id,connection_id,name,speciality) select '10000000-0000-0000-0000-000000000001',connection,'Second','General' from own$$,'42501',null,'nor puts another Agent on it');
reset role;
-- The tables' owner, which no grant or policy holds back: only the guards stand.
select throws_ok($$insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state) select '10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','http://hermes:8642',profile,'x','connected' from made where name='own'$$,
 '42501','hermesProfileNotShared','no writer saves a Connection to it in another Company');
select throws_ok($$insert into public.hermes_agents(company_id,connection_id,name,speciality) select '10000000-0000-0000-0000-000000000001',connection,'Second','General' from own$$,'42501','hermesProfileNotShared','nor puts another Agent on it');
select throws_ok($$update public.hermes_agents set company_id='10000000-0000-0000-0000-000000000002' where id=(select agent from own)$$,'42501','hermesProfileNotShared','nor moves its Agent to another Company');
select throws_ok($$update public.hermes_agents set id=gen_random_uuid() where id=(select agent from own)$$,'42501','hermesProfileNotShared','nor gives its Agent another id');
select throws_ok($$update public.hermes_connections set company_id='10000000-0000-0000-0000-000000000002' where id=(select connection from own)$$,'42501','hermesProfileNotShared','nor moves its Connection to another Company');

create temporary table reserve(key uuid primary key, conversation uuid);
grant select on reserve to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_run('a7200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from own),'a7300000-0000-0000-0000-000000000001','Hello'),
 (select connection from own),'a Run is reserved on the Agent''s own profile');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.begin_agent_tools((select agent from own));
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.reserve_conversation_run('a7200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from own),'a7300000-0000-0000-0000-000000000002','Hello')$$,
 '55000','agentLevelPending','none while its tools are being changed');
select throws_ok($$select public.reserve_conversation_run('a7200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from own),'a7300000-0000-0000-0000-000000000001','Hello')$$,
 '55000','agentLevelPending','and a held reservation is checked again on retry');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_agent_profile((select agent from own),(select profile from made where name='own'),1,public.engine_tool_policy());
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select is(public.reserve_conversation_run('a7200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from own),'a7300000-0000-0000-0000-000000000002','Hello'),
 (select connection from own),'once the read-back is recorded, Runs are reserved again');
reset role;
update public.agent_profiles set tools_policy=1;
set local role authenticated;
select throws_ok($$select public.reserve_conversation_run('a7200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from own),'a7300000-0000-0000-0000-000000000003','Hello')$$,
 '55000','agentLevelPending','none while its tools were applied under another policy');
reset role;
update public.agent_profiles set tools_policy=public.engine_tool_policy();
set local role authenticated;
select is(public.set_agent_level('10000000-0000-0000-0000-000000000001',3),3,'the Owner raises the level');
select throws_ok($$select public.reserve_conversation_run('a7200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from own),'a7300000-0000-0000-0000-000000000003','Hello')$$,
 '55000','agentLevelPending','none while its tools are another level''s');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select results_eq($$select agent_id,profile,agent_level::int,tools_level::int,instructions from public.agent_profile_work()$$,
 $$select agent,profile,3,1,'You write for RS Learning.' from made where name='own'$$,'the worker is given the profile to bring to the new level');
select public.begin_agent_tools((select agent from own));
select public.record_agent_profile((select agent from own),(select profile from made where name='own'),3,public.engine_tool_policy());
select is((select count(*)::int from public.agent_profile_work()),0,'and nothing once its read-back is recorded');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select is(public.reserve_conversation_run('a7200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from own),'a7300000-0000-0000-0000-000000000003','Hello'),
 (select connection from own),'then Runs are reserved at the new level');
reset role;

set local session_replication_role=replica;
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) select 'a7000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000001','http://127.0.0.1:9',profile,'ciphertext','connected','0.23.0','{run_submission}' from made where name='own';
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) select 'a7000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000002',
 '20000000-0000-0000-0000-000000000001','http://127.0.0.1:9',profile,'ciphertext','connected','0.23.0','{run_submission}' from made where name='own';
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values
 ('a7000000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000011','Copy','General'),
 ('a7000000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000002','a7000000-0000-0000-0000-000000000012','Borrowed','General');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('a7200000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000021','Copy'),
 ('a7200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select agent from own),'Writer');
insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message) values
 ('a7200000-0000-0000-0000-000000000021','a7300000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000021','Hello'),
 ('a7200000-0000-0000-0000-000000000002','a7300000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select agent from own),'Hello');
insert into public.channel_messages(id,company_id,channel_id,author,person_id,author_name,body,send_key) overriding system value values
 (-1,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','@Copy hello',gen_random_uuid()),
 (-2,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','@Writer hello',gen_random_uuid());
insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input) values
 (-1,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000021','Copy',gen_random_uuid(),'Omar: hello'),
 (-2,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',(select agent from own),'Writer',gen_random_uuid(),'Omar: hello');
insert into public.work_comments(id,company_id,card_id,body,author_id) overriding system value values
 (-1,'10000000-0000-0000-0000-000000000001',-1,'@Copy hello','20000000-0000-0000-0000-000000000001'),
 (-2,'10000000-0000-0000-0000-000000000001',-1,'@Writer hello','20000000-0000-0000-0000-000000000001');
insert into public.note_runs(note_id,company_id,card_id,agent_id,agent_name,session,input) values
 (-1,'10000000-0000-0000-0000-000000000001',-1,'a7000000-0000-0000-0000-000000000021','Copy',gen_random_uuid(),'Omar: hello'),
 (-2,'10000000-0000-0000-0000-000000000001',-1,(select agent from own),'Writer',gen_random_uuid(),'Omar: hello');
set local session_replication_role=origin;
set local role authenticated;
select throws_ok($$select public.reserve_conversation_run('a7200000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000021','a7300000-0000-0000-0000-000000000031','Hello')$$,
 '42501','hermesProfileNotShared','a Run of another Agent of the Company is refused at its reservation');
select throws_ok($$select public.reserve_conversation_run('a7200000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000002','a7000000-0000-0000-0000-000000000022','a7300000-0000-0000-0000-000000000032','Hello')$$,
 '42501','hermesProfileNotShared','and so is one of an Agent in another Company');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select count(*)::int from public.claim_conversation_turn('a7200000-0000-0000-0000-000000000021')),0,'another Agent''s waiting turn is not started');
select is((select count(*)::int from public.begin_channel_start(-1)),0,'nor its channel Run');
select is((select count(*)::int from public.begin_note_start(-1)),0,'nor its note Run');
reset role;
select ok((select failed_at is not null from public.conversation_queued_turns where send_key='a7300000-0000-0000-0000-000000000021'),'the turn is failed, as on another Company''s profile');
set local role service_role;
select public.begin_agent_tools((select agent from own));
select is((select count(*)::int from public.claim_conversation_turn('a7200000-0000-0000-0000-000000000002')),0,'the Agent''s own turn waits while its tools change');
select is((select count(*)::int from public.begin_channel_start(-2)),0,'and so does its channel Run');
select is((select count(*)::int from public.begin_note_start(-2)),0,'and its note Run');
reset role;
select ok((select failed_at is null from public.conversation_queued_turns where send_key='a7300000-0000-0000-0000-000000000022'),'its turn is not failed');
set local role service_role;
select public.record_agent_profile((select agent from own),(select profile from made where name='own'),3,public.engine_tool_policy());
select results_eq($$select connection from public.claim_conversation_turn('a7200000-0000-0000-0000-000000000002')$$,$$select connection from own$$,'then its turn starts on its own profile');
select results_eq($$select connection from public.begin_channel_start(-2)$$,$$select connection from own$$,'and its channel Run');
select results_eq($$select connection from public.begin_note_start(-2)$$,$$select connection from own$$,'and its note Run');

select ok(public.forget_company_profile((select connection from own)),'tool health forgets the lost profile');
reset role;
select results_eq($$select tools_level,tools_policy,tools_pending from public.agent_profiles$$,$$values (null::smallint,null::integer,false)$$,'its record stays, with no tool state');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.reserve_conversation_run('a7200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from own),'a7300000-0000-0000-0000-000000000004','Hello')$$,
 '55000','agentLevelPending','no Run starts on it until it is made again');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select results_eq($$select agent_id,tools_level from public.agent_profile_work()$$,$$select agent,null::smallint from own$$,'the worker is given it to make again');
select throws_ok($$select public.record_agent_profile((select agent from own),'co-10000000000000000000000000000001',3,public.engine_tool_policy())$$,'22023','agentProfileInvalid','a record names the Agent''s own profile');
select throws_ok($$select public.record_agent_profile((select agent from own),(select profile from made where name='own'),3,1)$$,'22023','agentProfileInvalid','and the policy of now');
select public.record_agent_profile((select agent from made where name='lead'),(select profile from made where name='lead'),3,public.engine_tool_policy());
reset role;
select is((select count(*)::int from public.agent_profiles),1,'the worker never writes an owner record');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','remove',null,(select agent from own))$$,'the Owner removes the Agent');
reset role;
select is((select count(*)::int from public.agent_profiles),0,'and its owner record goes with it');
select * from finish();
rollback;
