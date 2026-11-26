begin;
create extension if not exists pgtap with schema extensions;
select plan(84);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,instructions,profile) values
 ('a2300000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f2300000-0000-0000-0000-000000000001','Lead','General',true,null,'default'),
 ('a2300000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f2300000-0000-0000-0000-000000000002','Faye','Marketing',false,'Write short.','default'),
 ('a2300000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f2300000-0000-0000-0000-000000000003','Lead Writer','Copy',false,null,'default'),
 ('a2300000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','f2300000-0000-0000-0000-000000000004','Secret','Hidden',false,null,'default');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',p,a from unnest(array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003']::uuid[]) p,
  unnest(array['a2300000-0000-0000-0000-000000000002','a2300000-0000-0000-0000-000000000003']::uuid[]) a;
insert into auth.users(id,email) values ('b2300000-0000-0000-0000-000000000001','added@example.test'),('b2300000-0000-0000-0000-000000000002','invited@example.test'),('b2300000-0000-0000-0000-000000000003','elsewhere@example.test');
insert into public.people(id,name) values ('b2300000-0000-0000-0000-000000000001','Nour Hassan'),('b2300000-0000-0000-0000-000000000003','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','b2300000-0000-0000-0000-000000000003','manager');
create temporary table general(id uuid) on commit drop;
insert into general values ('69000000-0000-0000-0000-000000000001');
grant select on general to authenticated, service_role;
create temporary table sent(label text, id bigint) on commit drop;
grant select, insert on sent to authenticated, service_role;

select is((select count(*)::int from public.companies c where (select count(*) from public.channels k where k.company_id=c.id and k.kind='general')=1),(select count(*)::int from public.companies),'every Company has exactly one general channel');
insert into public.company_engines(id,address,key_encrypted) values ('e3821000-0000-4000-8000-000000000003','http://engine:8642','cipher');
insert into public.companies(id,slug,name,engine_id) values ('10000000-0000-0000-0000-000000000023','channels-new','Channels new','e3821000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.channels where company_id='10000000-0000-0000-0000-000000000023' and kind='general'),1,'a new Company gets its general channel');
select throws_ok($$insert into public.channels(company_id,kind) values ('10000000-0000-0000-0000-000000000001','general')$$,'23505',null,'a Company never has a second general channel');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select array_agg(person::text order by person) from public.channel_members((select id from general))),
 array['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000005'],
 'the general channel holds every Member, those once named for the legacy role agents too (spec #695)');
select is((select role::text from public.channel_members((select id from general)) where person='20000000-0000-0000-0000-000000000004'),'viewer','each Member comes with their role');

reset role;
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000001','b2300000-0000-0000-0000-000000000001','contributor');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select ok(exists(select 1 from public.channel_members((select id from general)) where person='b2300000-0000-0000-0000-000000000001' and name='Nour Hassan'),'a Member added later is in the general channel');
select set_config('request.jwt.claim.sub','b2300000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.channels where id=(select id from general)),1,'and reads it');
select is((select count(*)::int from public.channel_members((select id from general))),11,'and reads who is in it');
reset role;
insert into public.member_invitations(company_id,email,role) values ('10000000-0000-0000-0000-000000000001','Invited@example.test','viewer');
set local role authenticated;
select set_config('request.jwt.claim.sub','b2300000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.channels),0,'before accepting, no channel is shown');
select lives_ok($$select public.claim_invitations()$$,'the invited person accepts');
select ok(public.in_channel((select id from general)),'and is in the general channel');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.channel_members((select id from general))),12,'the Owner reads both newcomers in it');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select isnt(public.post_channel_message((select id from general),'c2300000-0000-0000-0000-000000000001','Morning, team'),null,'the Owner writes');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select isnt(public.post_channel_message((select id from general),'c2300000-0000-0000-0000-000000000002','Meta is ready this week'),null,'the Manager writes');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select isnt(public.post_channel_message((select id from general),'c2300000-0000-0000-0000-000000000003','Google Search two days later'),null,'a Contributor writes');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.post_channel_message((select id from general),'c2300000-0000-0000-0000-000000000004','I want to write')$$,'42501','channelNotAllowed','a Viewer cannot write');
select is((select array_agg(body order by id) from public.channel_messages where channel_id=(select id from general)),array['Morning, team','Meta is ready this week','Google Search two days later'],'a Viewer reads every message');
select is((select array_agg(author_name order by id) from public.channel_messages where channel_id=(select id from general)),array['عمر','مدير','مراجع'],'each message carries its writer, from the session');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.channel_messages),3,'the Manager reads them');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.channel_messages),3,'and a Contributor');
select is(public.post_channel_message((select id from general),'c2300000-0000-0000-0000-000000000003','Google Search two days later'),(select id from public.channel_messages where body='Google Search two days later'),'the same send key again is the same message');
select is((select count(*)::int from public.channel_messages),3,'and adds nothing');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.post_channel_message((select id from general),'c2300000-0000-0000-0000-000000000003','Not mine')$$,'22023','channelFailed','another person''s send key is refused');
select throws_ok($$select public.post_channel_message((select id from general),'c2300000-0000-0000-0000-000000000005','   ')$$,'22023','channelFailed','an empty message is refused');
select throws_ok($$select public.post_channel_message((select id from general),'c2300000-0000-0000-0000-000000000006',repeat('a',20001))$$,'22023','channelFailed','a message over 20,000 characters is refused');

select throws_ok($$insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values ('10000000-0000-0000-0000-000000000001',(select id from general),'person','20000000-0000-0000-0000-000000000002','x','x',gen_random_uuid())$$,'42501',null,'a Member cannot insert a message directly');
select throws_ok($$update public.channel_messages set body='changed'$$,'42501',null,'nor change one');
select throws_ok($$delete from public.channel_messages$$,'42501',null,'nor remove one');
select throws_ok($$select public.close_channel_run(1,null,'failed',null,null,null)$$,'42501',null,'nor end a Run');
select throws_ok($$select send_key from public.channel_messages$$,'42501',null,'nor read a sender''s key');
select throws_ok($$select input from public.channel_runs$$,'42501',null,'nor what a Run sent');

select set_config('request.jwt.claim.sub','b2300000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.channels where company_id='10000000-0000-0000-0000-000000000001')+(select count(*)::int from public.channel_messages)+(select count(*)::int from public.channel_runs),0,'a Member of another Company reads no channel, message or Run of it');
select throws_ok($$select public.post_channel_message((select id from general),'c2300000-0000-0000-0000-000000000007','Hello')$$,'P0002','channelNotFound','and cannot write in it');
select is((select count(*)::int from public.channel_members((select id from general))),0,'nor read who is in it');
reset role;
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.channel_messages)+(select count(*)::int from public.channels where company_id='10000000-0000-0000-0000-000000000001'),0,'a removed Member reads nothing of it');
select throws_ok($$select public.post_channel_message((select id from general),'c2300000-0000-0000-0000-000000000008','Hello')$$,'P0002','channelNotFound','and cannot write in it');
reset role;
update public.members set removed_at=null where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.channel_messages),3,'restored, they read it again');
reset role;
update public.companies set work_mode='alone' where id='10000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.channels where company_id='10000000-0000-0000-0000-000000000002'),0,'a Company worked alone shows no channel');
select throws_ok($$select public.post_channel_message((select id from public.channels where company_id='10000000-0000-0000-0000-000000000002'),'c2300000-0000-0000-0000-000000000009','Hello')$$,'P0002','channelNotFound','and none can be written in');
reset role;
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','contributor');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.channels where company_id='10000000-0000-0000-0000-000000000002'),1,'once a second Member joins, the Company is a team and its channel is there');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.channel_members((select id from public.channels where company_id='10000000-0000-0000-0000-000000000002'))),2,'with both of them in it');
reset role;
update public.companies set work_mode=null where id='10000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','b2300000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.channels where company_id='10000000-0000-0000-0000-000000000003'),1,'a Company that has not answered yet has its channel');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into sent select x.label, public.post_channel_message((select id from general),gen_random_uuid(),x.body) from (values
 ('plain','Morning all'),('faye','@Faye plan the launch week'),('first','@faye, then @Lead'),('longest','@Lead Writer draft the teaser'),
 ('email','write to x@faye.com'),('longer word','@Fayed is not an Agent'),('member','@مدير شوف ده'),('arabic','شوف ده يا @Faye،'),('hidden','@Secret look')) x(label,body);
reset role;
select is((select count(*)::int from public.channel_runs r join sent s on s.id=r.message_id where s.label in ('plain','email','longer word','member','hidden')),0,
 'no Run for ordinary talk, an address, a longer word, a Member, or an Agent hidden from the sender');
select is((select array_agg(s.label||':'||r.agent_name order by s.id,r.ordinal) from public.channel_runs r join sent s on s.id=r.message_id),
 array['faye:Faye','first:Faye','first:Lead','longest:Lead Writer','arabic:Faye'],
 'a mention starts one Run for each name it calls, in the order named and the longest at one place (#152)');
select is((select input from public.channel_runs r join sent s on s.id=r.message_id where s.label='faye'),'مراجع: @Faye plan the launch week','the Agent reads the message with its writer''s first name');
select is((select instructions from public.channel_runs r join sent s on s.id=r.message_id where s.label='faye'),'Write short.','with its own instructions');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into sent values ('owner hidden',public.post_channel_message((select id from general),gen_random_uuid(),'@Secret look'));
reset role;
select is((select agent_name from public.channel_runs r join sent s on s.id=r.message_id where s.label='owner hidden'),'Secret','the Owner, who sees every Agent, can call it');

set local role service_role;
select is((select array_agg(message order by message) from public.channel_runs_due(null,null,0)),null::bigint[],'a fresh Run belongs to its sender''s request for its first minute');
select is((select array_agg(message) from public.channel_runs_due(null,(select id from sent where label='faye'),0)),array[(select id from sent where label='faye')],'which drives it at once');
select is((select attempt from public.begin_channel_start((select id from sent where label='faye'))),1,'the first attempt');
select is((select profile from public.channel_runs_due(null,(select id from sent where label='faye'),0)),'default','pins the Agent''s profile');
select is((select run from public.channel_runs_due(null,(select id from sent where label='faye'),0)),null,'and has no Run before it started');
select ok(public.answer_channel_start((select id from sent where label='faye'),1,'run-faye'),'the run id is recorded');
select ok((select profile from public.channel_runs_due(null,(select id from sent where label='faye'),0)) is not null,'a started Run comes with its pinned profile');
select is((select count(*)::int from public.channel_runs_due(null,null,(select id from sent where label='faye')) where message=(select id from sent where label='faye')),0,'a page starts after the message it is given');
select ok(public.answer_channel_start((select id from sent where label='faye'),2,'run-faye'),'the same run named again by another attempt is the same');
select is((select count(*)::int from public.begin_channel_start((select id from sent where label='faye'))),0,'a started Run is not started again');
select ok(public.close_channel_run((select id from sent where label='faye'),'run-faye','completed','Here is the week.',120,30),'the Run ends with its reply');
select ok(not public.close_channel_run((select id from sent where label='faye'),'run-faye','completed','Here is the week.',120,30),'a second close changes nothing');
reset role;
select is((select array_agg(author||':'||author_name||':'||body) from public.channel_messages where reply_to=(select id from sent where label='faye')),array['agent:Faye:Here is the week.'],'one reply, posted in the channel by the Agent');
select is((select outcome from public.channel_runs where message_id=(select id from sent where label='faye')),'completed','with the Run''s outcome');
set local role service_role;
select is((select attempt from public.begin_channel_start((select id from sent where label='first'))),1,'one attempt');
select is((select attempt from public.begin_channel_start((select id from sent where label='first'))),2,'and a second at the same time');
select ok(not public.answer_channel_start((select id from sent where label='first'),1,null),'the first one refused does not end it');
select ok(public.answer_channel_start((select id from sent where label='first'),2,'run-first'),'the second names the Run');
select is((select attempt from public.begin_channel_start((select id from sent where label='longest'))),1,'a lone attempt');
select ok(public.answer_channel_start((select id from sent where label='longest'),1,null),'refused, it ends');
reset role;
select is((select outcome from public.channel_runs where message_id=(select id from sent where label='longest')),'failed','as failed');
select is((select count(*)::int from public.channel_messages where reply_to=(select id from sent where label='longest')),0,'with no reply');
update public.channel_runs set created_at=now()-interval '11 minutes' where message_id=(select id from sent where label='arabic');
set local role service_role;
select is((select array_agg(message) from public.channel_runs_due(null,null,0) where message=(select id from sent where label='arabic')),array[(select id from sent where label='arabic')],'after its first minute any driver takes a Run');
select is((select count(*)::int from public.begin_channel_start((select id from sent where label='arabic'))),0,'after ten minutes it is not started');
reset role;
select is((select outcome from public.channel_runs where message_id=(select id from sent where label='arabic')),'failed','it failed');
set local role service_role;
select is((select attempt from public.begin_channel_start((select id from sent where label='owner hidden'))),1,'a start is sent');
select is((select count(*)::int from public.channel_runs_due(null,null,0) where message=(select id from sent where label='owner hidden')),0,'while its answer may still come, no other driver sends it again');
reset role;
update public.channel_runs set attempted_at=now()-interval '31 seconds' where message_id=(select id from sent where label='owner hidden');
set local role service_role;
select is((select count(*)::int from public.channel_runs_due(null,null,0) where message=(select id from sent where label='owner hidden')),1,'after thirty seconds any driver asks again');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.channel_runs where outcome is null),3,'a Viewer reads which Runs are still open, both Agents of a message that called two included (#152)');

reset role;
set local role service_role;
-- The previous version's provider put each Company with no Agent on the shared `default` profile (#342 dropped it).
reset role;
insert into public.hermes_agents(company_id,name,speciality,is_default,profile) select c.id,'Lead','General',true,'default' from public.companies c
 where not exists(select 1 from public.hermes_agents a where a.company_id=c.id) and exists(select 1 from public.members m where m.company_id=c.id and m.role='owner' and m.removed_at is null);
set local role service_role;
select cmp_ok((select count(*)::int from public.hermes_agents where profile='default'),'>=',1,'Aleem gets Lead on the shared profile');
select lives_ok($$select public.record_company_profile('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003')$$,'and its own profile is made');
reset role;
update public.company_profiles set skills_shared=true where company_id='10000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','b2300000-0000-0000-0000-000000000003',true);
insert into sent values ('aleem',public.post_channel_message((select id from public.channels where company_id='10000000-0000-0000-0000-000000000003'),gen_random_uuid(),'@Lead hello'));
reset role;
set local role service_role;
select is((select attempt from public.begin_channel_start((select id from sent where label='aleem'))),1,'Aleem''s Lead is asked');
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003'),0,'its open channel Run holds the move');
select ok(public.close_channel_run((select id from sent where label='aleem'),null,'lost',null,null,null),'once it ended');
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003'),1,'the Company moves');
reset role;
set local role service_role;
select ok(public.close_channel_run((select id from sent where label='first'),'run-first','completed',repeat('x',200005),null,null),'an over-long reply still ends its Run');
reset role;
select is((select length(body) from public.channel_messages where reply_to=(select id from sent where label='first')),200000,'kept to its first 200,000 characters');
select * from finish();
rollback;
