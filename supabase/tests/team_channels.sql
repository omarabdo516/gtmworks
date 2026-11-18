begin;
create extension if not exists pgtap with schema extensions;
select plan(79);
-- RS Learning's seeded Members: the Owner (عمر), the Manager (مدير), a Contributor (مراجع), the Viewer (مشاهد) and a
-- second Contributor (عضو). Lead is the main Agent, Faye is shown to the Manager and the Contributor, Secret to nobody
-- but the Owner.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a2400000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f2400000-0000-0000-0000-000000000001','Lead','General',true,'default'),
 ('a2400000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f2400000-0000-0000-0000-000000000002','Faye','Marketing',false,'default'),
 ('a2400000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f2400000-0000-0000-0000-000000000003','Secret','Hidden',false,'default');
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a2400000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2400000-0000-0000-0000-000000000002');
insert into auth.users(id,email) values ('b2400000-0000-0000-0000-000000000001','elsewhere24@example.test'),('b2400000-0000-0000-0000-000000000002','later24@example.test');
insert into public.people(id,name) values ('b2400000-0000-0000-0000-000000000001','Karim'),('b2400000-0000-0000-0000-000000000002','Nour');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','b2400000-0000-0000-0000-000000000001','manager');
create temporary table made(label text, id uuid) on commit drop;
grant select, insert on made to authenticated;
create temporary table sent(label text, id bigint) on commit drop;
grant select, insert on sent to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

-- Who makes a channel and changes who is in it.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into made values ('launch',public.create_channel('10000000-0000-0000-0000-000000000001','c2400000-0000-0000-0000-000000000001','  #Launch week ',
 array['20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[],array['a2400000-0000-0000-0000-000000000003']::uuid[]));
select is((select kind||':'||name from public.channels where id=(select id from made where label='launch')),'team:Launch week','the Owner makes a team channel, named without the # and the spaces typed');
select is(public.create_channel('10000000-0000-0000-0000-000000000001','c2400000-0000-0000-0000-000000000001','Launch week',null,null),(select id from made where label='launch'),'the same request again is the same channel');
select is((select count(*)::int from public.channels where company_id='10000000-0000-0000-0000-000000000001' and kind='team'),1,'and makes no second one');
select is((select array_agg(person::text order by person) from public.channel_members((select id from made where label='launch'))),
 array['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004'],'its creator is in it with the Members chosen');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into made values ('ads',public.create_channel('10000000-0000-0000-0000-000000000001','c2400000-0000-0000-0000-000000000002','Ads',
 array['20000000-0000-0000-0000-000000000003']::uuid[],array['a2400000-0000-0000-0000-000000000002']::uuid[]));
select is((select name from public.channels where id=(select id from made where label='ads')),'Ads','a Manager makes one too');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001',gen_random_uuid(),'Mine',null,null)$$,'42501','channelNotAllowed','a Contributor cannot make a channel');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001',gen_random_uuid(),'Mine',null,null)$$,'42501','channelNotAllowed','nor can the Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001',gen_random_uuid(),'launch WEEK',null,null)$$,'23505','channelNameTaken','a name in use, in any case, is refused');
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001',gen_random_uuid(),'#General',null,null)$$,'23505','channelNameTaken','and the general channel''s name');
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001',gen_random_uuid(),'عام',null,null)$$,'23505','channelNameTaken','in Arabic too');
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001',gen_random_uuid(),'  # ',null,null)$$,'22023','channelNameMissing','a channel needs a name');
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001',gen_random_uuid(),repeat('a',33),null,null)$$,'22023','channelNameTooLong','of at most 32 characters');
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001',gen_random_uuid(),'Hidden',null,array['a2400000-0000-0000-0000-000000000003']::uuid[])$$,'P0002','agentNotFound','a Manager cannot put in an Agent hidden from them');
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001',gen_random_uuid(),'Robots',array['30000000-0000-0000-0000-000000000001']::uuid[],null)$$,'P0002','memberNotFound','nor a legacy role Agent as a person');
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001',gen_random_uuid(),'Outsider',array['b2400000-0000-0000-0000-000000000001']::uuid[],null)$$,'P0002','memberNotFound','nor someone outside the Company');
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001',null,'No key',null,null)$$,'22023','channelFailed','a request without a key is refused');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000001','c2400000-0000-0000-0000-000000000002','Ads',null,null)$$,'22023','channelFailed','another person''s request key is refused');
reset role;
update public.companies set work_mode='alone' where id='10000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok($$select public.create_channel('10000000-0000-0000-0000-000000000002',gen_random_uuid(),'Alone',null,null)$$,'42501','channelNotAllowed','a Company worked alone has no channels to make');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.set_channel_person((select id from made where label='ads'),'20000000-0000-0000-0000-000000000005',true)$$,'the Manager adds a Member');
select lives_ok($$select public.set_channel_person((select id from made where label='ads'),'20000000-0000-0000-0000-000000000005',true)$$,'adding them again changes nothing');
select is((select count(*)::int from public.channel_members((select id from made where label='ads')) where person='20000000-0000-0000-0000-000000000005'),1,'they are in it once');
select throws_ok($$select public.set_channel_person((select id from made where label='ads'),'20000000-0000-0000-0000-000000000002',false)$$,'42501','channelNotAllowed','nobody takes themselves out');
select throws_ok($$select public.set_channel_person((select id from made where label='ads'),'30000000-0000-0000-0000-000000000001',true)$$,'P0002','memberNotFound','a legacy role Agent is not added as a person');
select throws_ok($$select public.set_channel_person((select id from made where label='launch'),'20000000-0000-0000-0000-000000000005',true)$$,'P0002','channelNotFound','a Manager outside a channel cannot change it');
select throws_ok($$select public.set_channel_person('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005',false)$$,'42501','channelNotAllowed','the general channel''s people are never chosen');
select lives_ok($$select public.set_channel_agent((select id from made where label='ads'),'a2400000-0000-0000-0000-000000000001',true)$$,'the Manager adds an Agent');
select throws_ok($$select public.set_channel_agent((select id from made where label='ads'),'a2400000-0000-0000-0000-000000000003',true)$$,'P0002','agentNotFound','but not one hidden from them');
select lives_ok($$select public.set_channel_agent((select id from made where label='ads'),'a2400000-0000-0000-0000-000000000002',false)$$,'and takes one out');
select is((select array_agg(name order by name) from public.channel_agent_list((select id from made where label='ads'))),array['Lead'],'the channel has the Agents chosen');
select throws_ok($$select public.set_channel_agent('69000000-0000-0000-0000-000000000001','a2400000-0000-0000-0000-000000000002',false)$$,'42501','channelNotAllowed','the general channel''s Agents are never chosen');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.set_channel_person((select id from made where label='ads'),'20000000-0000-0000-0000-000000000004',true)$$,'42501','channelNotAllowed','a Contributor in the channel cannot change who is in it');
select throws_ok($$select public.set_channel_agent((select id from made where label='ads'),'a2400000-0000-0000-0000-000000000001',false)$$,'42501','channelNotAllowed','nor its Agents');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.set_channel_person((select id from made where label='launch'),'20000000-0000-0000-0000-000000000005',true)$$,'42501','channelNotAllowed','nor can the Viewer');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.set_channel_person((select id from made where label='ads'),'20000000-0000-0000-0000-000000000005',false)$$,'the Manager takes a Member out');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.channels where id=(select id from made where label='ads')),0,'who then no longer finds it');

-- A channel's Agents inside it, for a member who does not see them elsewhere.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select array_agg(name||':'||here_only) from public.channel_agent_list((select id from made where label='launch'))),array['Secret:true'],
 'a Contributor sees the channel''s Agent hidden from them elsewhere, marked as shown here only');
select is((select count(*)::int from public.hermes_agents where id='a2400000-0000-0000-0000-000000000003'),0,'it stays absent from their Agents');
select ok(not public.can_see_agent('10000000-0000-0000-0000-000000000001','a2400000-0000-0000-0000-000000000003'),'and hidden from them everywhere else');
insert into sent values ('secret',public.post_channel_message((select id from made where label='launch'),gen_random_uuid(),'@Secret plan the launch week'));
insert into sent values ('faye',public.post_channel_message((select id from made where label='launch'),gen_random_uuid(),'@Faye are you here?'));
insert into sent values ('general secret',public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Secret look'));
reset role;
select is((select agent_name from public.channel_runs where message_id=(select id from sent where label='secret')),'Secret','they call it in the channel, and its Run starts');
select is((select count(*)::int from public.channel_runs where message_id in (select id from sent where label in ('faye','general secret'))),0,
 'an Agent they see but the channel does not have is not called there, nor the hidden one in the general channel');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.send_conversation_message(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','a2400000-0000-0000-0000-000000000003','Hi',gen_random_uuid(),'team-channels-run')$$,
 'P0002','conversationNotFound','a direct Conversation with it stays impossible');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select array_agg(name||':'||here_only) from public.channel_agent_list((select id from made where label='launch'))),array['Secret:true'],'the Viewer in the channel sees it marked too');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select array_agg(name||':'||here_only) from public.channel_agent_list((select id from made where label='launch'))),array['Secret:false'],'the Owner, who sees every Agent, has no mark');
select is((select array_agg(name order by name) from public.channel_agent_list('69000000-0000-0000-0000-000000000001')),array['Faye','Lead','Secret'],'in the general channel the Owner''s Agents are every Agent they see');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select array_agg(name order by name) from public.channel_agent_list('69000000-0000-0000-0000-000000000001')),array['Faye','Lead'],'and a Contributor''s the ones they see');

-- A Member not in a channel does not see that it exists.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.channels where id=(select id from made where label='launch')),0,'a Member outside a channel does not find it');
select is((select count(*)::int from public.channel_messages where channel_id=(select id from made where label='launch'))
 +(select count(*)::int from public.channel_runs where channel_id=(select id from made where label='launch'))
 +(select count(*)::int from public.channel_people where channel_id=(select id from made where label='launch'))
 +(select count(*)::int from public.channel_agents where channel_id=(select id from made where label='launch')),0,'nor its messages, Runs, people or Agents');
select is((select count(*)::int from public.channel_members((select id from made where label='launch')))+(select count(*)::int from public.channel_agent_list((select id from made where label='launch'))),0,'nor who is in it');
select is((select array_agg(kind) from public.channel_sidebar('10000000-0000-0000-0000-000000000001')),array['general'],'their channel list has the general channel only');
select throws_ok($$select public.post_channel_message((select id from made where label='launch'),gen_random_uuid(),'Hello')$$,'P0002','channelNotFound','they cannot write in it');
select throws_ok($$select public.read_channel((select id from made where label='launch'),1)$$,'P0002','channelNotFound','nor mark it read');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into made values ('ops',public.create_channel('10000000-0000-0000-0000-000000000001','c2400000-0000-0000-0000-000000000003','Ops',array['20000000-0000-0000-0000-000000000003']::uuid[],null));
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.channels where id=(select id from made where label='ops')),0,'the Owner does not see a channel they are not in');
select throws_ok($$select public.set_channel_person((select id from made where label='ops'),'20000000-0000-0000-0000-000000000005',true)$$,'P0002','channelNotFound','nor change it');
select set_config('request.jwt.claim.sub','b2400000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.channels where company_id='10000000-0000-0000-0000-000000000001')
 +(select count(*)::int from public.channel_sidebar('10000000-0000-0000-0000-000000000001')),0,'a Member of another Company sees none of them');
reset role;
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.channels where company_id='10000000-0000-0000-0000-000000000001'),0,'a removed Member is in no channel');
reset role;
update public.members set removed_at=null where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000003';
set local role authenticated;
select is((select array_agg(name order by name) from public.channels where kind='team'),array['Ads','Launch week','Ops'],'restored, they are back in theirs');

-- Unread counts. #Launch week holds the Owner, the Contributor and the Viewer; the Contributor wrote twice in it.
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),0,'the writer has nothing unread from their own messages');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),2,'each other member has both new');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),2,'the Viewer too');
reset role;
set local role service_role;
select ok(public.close_channel_run((select id from sent where label='secret'),null,'completed','Here is the week.',null,null),'the Agent replies');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),1,'an Agent''s reply is new to the writer too');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),3,'and to everyone else');
select lives_ok($$select public.read_channel((select id from made where label='launch'),(select max(id) from public.channel_messages where channel_id=(select id from made where label='launch')))$$,'the Owner opens the channel');
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),0,'which clears their count');
select is((select read_through from public.channel_reads where channel_id=(select id from made where label='launch')),(select max(id) from public.channel_messages where channel_id=(select id from made where label='launch')),'they read their own read position');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),3,'and nobody else''s');
select is((select count(*)::int from public.channel_reads where channel_id=(select id from made where label='launch')),0,'whose read position stays theirs');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.read_channel((select id from made where label='launch'),1)$$,'an older position');
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),0,'never moves it back');
select lives_ok($$select public.read_channel((select id from made where label='launch'),9223372036854775807)$$,'a position past the newest message');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into sent values ('after',public.post_channel_message((select id from made where label='launch'),gen_random_uuid(),'One more thing'));
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),1,'is held at the newest, so the next message is new');
select lives_ok($$select public.set_channel_person((select id from made where label='launch'),'20000000-0000-0000-0000-000000000005',true)$$,'the Owner adds a Member to the channel');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),0,'what was written before they joined is not new to them');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into sent values ('joined',public.post_channel_message((select id from made where label='launch'),gen_random_uuid(),'Welcome'));
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where id=(select id from made where label='launch')),1,'what comes after is');

-- The general channel counts the same way, from the moment a Member joined the Company.
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where kind='general'),1,'a Member has the general channel''s new message');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where kind='general'),0,'its writer has none');
reset role;
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000001','b2400000-0000-0000-0000-000000000002','contributor');
set local role authenticated;
select set_config('request.jwt.claim.sub','b2400000-0000-0000-0000-000000000002',true);
select is((select array_agg(kind||':'||unread) from public.channel_sidebar('10000000-0000-0000-0000-000000000001')),array['general:0'],'a Member who joins later starts with nothing unread in the general channel');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select lives_ok($$select public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'Hello Nour')$$,'then someone writes there');
select set_config('request.jwt.claim.sub','b2400000-0000-0000-0000-000000000002',true);
select is((select unread from public.channel_sidebar('10000000-0000-0000-0000-000000000001') where kind='general'),1,'and it is new to them');

select * from finish();
rollback;
