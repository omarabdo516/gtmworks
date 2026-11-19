-- #151: a channel's work gets a Card. The first Agent called in a team channel puts one Card on the board under "In
-- progress", titled with the channel's name, tied to the channel, with the quiet line under it and gtmworks's log row;
-- the general channel never gets one, a Viewer and a Member outside the channel cause none, and every Agent that answers
-- is logged on the Card for "Worked on it:". Only the database ties a Card to a channel.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- RS Learning's seeded Members: the Owner, the Manager, the Contributor, the Viewer and a second Contributor. Faye is an
-- Agent shown to the Contributor; Lead is the main Agent, shown to everyone. The Viewer is in the channel and does not
-- see Faye, so the Card is on their board nowhere.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a1510000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f1510000-0000-0000-0000-000000000001','Faye','Marketing',false,'default'),
 ('a1510000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f1510000-0000-0000-0000-000000000002','Lead','General',true,'default');
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1510000-0000-0000-0000-000000000001');
create temporary table made(label text, id uuid) on commit drop;
grant select, insert on made to authenticated;
create temporary table sent(label text, id bigint) on commit drop;
grant select, insert on sent to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

-- The Owner makes a team channel with the Contributor and the Viewer in it, and Faye its Agent.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into made values ('launch',public.create_channel('10000000-0000-0000-0000-000000000001','c1510000-0000-0000-0000-000000000001','Launch week',
 array['20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[],array['a1510000-0000-0000-0000-000000000001']::uuid[]));

-- The Contributor calls the channel's Agent: one Card appears under In progress, named for the channel, tied to it,
-- with the Agent called, and the channel and the log each get one line.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into sent values ('first',public.post_channel_message((select id from made where label='launch'),gen_random_uuid(),'@Faye plan the launch'));
reset role;
select is((select count(*)::int from public.work_cards where company_id='10000000-0000-0000-0000-000000000001'
 and channel_id=(select id from made where label='launch')),1,'the first Agent called in a team channel makes one Card');
select is((select title from public.work_cards where channel_id=(select id from made where label='launch')),'Launch week','titled with the channel''s name');
select is((select s.board_column from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id
 where w.channel_id=(select id from made where label='launch')),'progress','under In progress');
select is((select agent_id from public.work_cards where channel_id=(select id from made where label='launch')),'a1510000-0000-0000-0000-000000000001'::uuid,'with the Agent called');
select is((select conversation_id from public.work_cards where channel_id=(select id from made where label='launch')),null::uuid,'and no Conversation');
select is((select count(*)::int from public.channel_notes where channel_id=(select id from made where label='launch') and kind='card'
 and card_id=(select id from public.work_cards where channel_id=(select id from made where label='launch'))),1,'the channel gets one quiet line for its Card');
select is((select actor_kind||':'||card_id::text from public.company_log where action='channel_card_added'
 and card_id=(select id from public.work_cards where channel_id=(select id from made where label='launch'))),'system:'
 ||(select id::text from public.work_cards where channel_id=(select id from made where label='launch')),'and the log one row by gtmworks on the Card');
select is((select count(*)::int from public.company_log where action='channel_card_added' and card_id=(select id from public.work_cards
 where channel_id=(select id from made where label='launch'))),1,'the row is written once');

-- A second call, and a second Agent on the same message, change nothing: one Card a channel. Lead joins the channel so a
-- message can call two of its Agents.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_channel_agent((select id from made where label='launch'),'a1510000-0000-0000-0000-000000000002',true)$$,
 'the Owner puts Lead in the channel too');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into sent values ('second',public.post_channel_message((select id from made where label='launch'),gen_random_uuid(),'@Faye @Lead anything else'));
reset role;
select is((select count(*)::int from public.work_cards where channel_id=(select id from made where label='launch')),1,'a second call, with two Agents, makes no second Card');
select is((select count(*)::int from public.channel_notes where channel_id=(select id from made where label='launch') and kind='card'),1,'nor a second quiet line');
select is((select count(*)::int from public.company_log where action='channel_card_added'),1,'nor a second log row');

-- Every Agent that answers in the channel is logged on the Card, so "Worked on it:" names both.
set local role service_role;
select ok(public.close_channel_run((select id from sent where label='second'),null,'completed','Plan is ready.',null,null),'the first Agent answers');
select ok(public.close_channel_run((select id from sent where label='second'),null,'completed','And the copy.',null,null),'the second Agent answers too');
reset role;
select is((select count(*)::int from public.company_log where action='channel_reply'
 and card_id=(select id from public.work_cards where channel_id=(select id from made where label='launch'))),2,'each answer is logged on the Card');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select array_agg(h.name order by h.name) from public.work_cards w
 cross join lateral unnest(public.crew(w)) c(id) join public.hermes_agents h on h.id=c.id
 where w.channel_id=(select id from made where label='launch')),array['Faye','Lead'],'so "Worked on it:" lists both Agents');

-- The general channel never gets a Card.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into sent values ('general',public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Lead hello there'));
reset role;
select is((select count(*)::int from public.work_cards w join public.channels k on k.id=w.channel_id
 where k.company_id='10000000-0000-0000-0000-000000000001' and k.kind='general'),0,'the general channel never gets a Card');

-- Only a Member of the channel who may write causes one.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.post_channel_message((select id from made where label='launch'),gen_random_uuid(),'@Faye write it')$$,
 '42501','channelNotAllowed','the Viewer in the channel cannot call an Agent, so causes no Card');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.post_channel_message((select id from made where label='launch'),gen_random_uuid(),'@Faye write it')$$,
 'P0002','channelNotFound','a Manager outside the channel cannot either');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.post_channel_message((select id from made where label='launch'),gen_random_uuid(),'@Faye write it')$$,
 'P0002','channelNotFound','nor another Member outside it');
reset role;
select is((select count(*)::int from public.work_cards where channel_id=(select id from made where label='launch')),1,'and no other Card is made');

-- A Member sees the Card on the board only while they see its Agent, as every Card.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.board_cards('10000000-0000-0000-0000-000000000001')
 where channel_id=(select id from made where label='launch')),1,'a Member who sees its Agent sees the Card on the board');
select is(public.channel_board_card((select id from made where label='launch'))->>'title','Launch week','and the channel''s "On the board" names it');
select is(public.channel_board_card((select id from made where label='launch'))->>'column','progress','with its column now');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.board_cards('10000000-0000-0000-0000-000000000001')
 where channel_id=(select id from made where label='launch')),0,'a Member who does not see its Agent does not');
select is(public.channel_board_card((select id from made where label='launch')),null::jsonb,'and their channel details have no "On the board"');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.channel_board_card((select id from made where label='launch')),null::jsonb,'a Member outside the channel reads none of it');
select is((select count(*)::int from public.channel_messages where channel_id=(select id from made where label='launch')),0,'nor a channel message');

-- The channel's members read it, the Viewer included; the Card's row follows the column it stands in.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select ok((select count(*) from public.channel_messages where channel_id=(select id from made where label='launch'))>0,'a Viewer in the channel reads its messages');
reset role;
update public.work_cards set stage_id=(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001'
 and kind='review' order by position limit 1) where channel_id=(select id from made where label='launch');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.channel_board_card((select id from made where label='launch'))->>'column','waiting','a Card in a review stage reads as waiting');
select is(public.channel_board_card((select id from made where label='launch'))->>'waiting','true','with its waiting mark');

-- Only the database ties a Card to a channel.
select throws_ok($$insert into public.work_cards(company_id,stage_id,title,channel_id) values('10000000-0000-0000-0000-000000000001',
 (select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' order by position limit 1),'Mine',(select id from made where label='launch'))$$,
 '42501','cardChannelProtected','no Member makes a Card tied to a channel by hand');
select throws_ok($$update public.work_cards set channel_id=null where channel_id=(select id from made where label='launch')$$,
 '42501','cardChannelProtected','nor unties one');

select * from finish();
rollback;
