begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
-- #182, #183: Good morning is changed by an active Owner or Manager of its Company, for the main Agent, and each change is one row of the log; each run of its job is recorded once, and opens a new
-- Conversation with the main Agent for each Member with anything in a part of their card, never one for a Member with
-- nothing. RS Learning: 1 Owner, 2 Manager, 3 Contributor, 4 Viewer, 5 Contributor. Written without the guards, as
-- agent_routines.sql does.
set local session_replication_role=replica;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e1000000-0000-0000-0000-000000000181','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000181','Lead','General',true,'co-10000000000000000000000000000001'),
 ('e1000000-0000-0000-0000-000000000182','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000182','Ads','Meta ads',false,'ag-e1000000000000000000000000000182');
-- The Contributor 3 works with Ads; the Manager and the Contributor 5 do not see it.
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000182');
-- Something waits on the Contributor 5 alone: an item of their own "Waiting on you".
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c1000000-0000-0000-0000-000000000181','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','e1000000-0000-0000-0000-000000000181','Lead');
insert into public.waiting_items(company_id,person_id,kind,title,conversation_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','question','Which offer goes first?','c1000000-0000-0000-0000-000000000181');
set local session_replication_role=origin;

-- The worker records a run (as the service role): the Owner sees Ads's result, the Contributor 3 works with Ads, and
-- something waits on the Contributor 5; the Manager and the Viewer have nothing in any part.
select is(public.record_good_morning('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000181','local-0001','2026-11-11','2026-11-11T07:00:00Z','Good morning, team.',
 jsonb_build_array(jsonb_build_object('agent','e1000000-0000-0000-0000-000000000182','routine','Ad-pause routine','line','Paused the Video 2 ad when cost per lead hit EGP 52','at','2026-11-11T00:40:00Z'))),
 3,'three Members get the morning');
select is((select array_agg(person_id::text order by person_id) from public.conversations where good_morning is not null and person_id::text like '20000000%'),
 array['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000005'],'the Owner, the Contributor who sees Ads and the one something waits on');
select is((select jsonb_build_array(c.agent_id,c.good_morning_day,m.author,m.body,m.run_id like 'good-morning:%') from public.conversations c join public.conversation_messages m on m.conversation_id=c.id
  where c.person_id='20000000-0000-0000-0000-000000000003' and c.good_morning is not null),
 jsonb_build_array('e1000000-0000-0000-0000-000000000181','2026-11-11','agent','Good morning, team.',true),'a new Conversation with the main Agent holding the run''s reply');
select is(current_setting('request.jwt.claim.sub',true),'','the caller''s own identity is back after the Members are read');
select is(public.record_good_morning('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000181','local-0001','2026-11-11','2026-11-11T07:00:00Z','Good morning, team.','[]'::jsonb),
 null,'a run is recorded once');
select is(public.record_good_morning('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000181','local-0002','2026-11-12','2026-11-12T07:00:00Z',null,'[]'::jsonb),
 0,'a run that sent nothing opens no Conversation');
select ok((select greeting is null from public.good_mornings where session_id='local-0002'),'and is kept with no greeting');

-- Each card holds only what its reader may see.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.good_morning_results),1,'the Contributor who works with Ads reads its result');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.good_morning_results),0,'the Manager who does not see Ads reads none');
reset role;
select ok(not has_function_privilege('authenticated','public.record_good_morning(uuid,uuid,text,date,timestamptz,text,jsonb)','execute'),'no Member writes a morning');
select ok(not has_function_privilege('anon','public.good_morning_work()','execute'),'no signed-out caller reads the worker''s list');

-- A Member's first reply in a morning Conversation carries the greeting as the Run's history, since the Run starts a new
-- Engine session that never held it; a retry carries the same, and a plain Conversation carries none.
set local session_replication_role=replica;
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile,created_at)
 select c.id,'b1830000-0000-0000-0000-000000000001',c.company_id,a.connection_id,c.person_id,a.id,'Explain the second point',a.profile,now()
 from public.conversations c join public.hermes_agents a on a.id=c.agent_id where c.good_morning is not null and c.person_id='20000000-0000-0000-0000-000000000003';
insert into public.conversation_run_notes(conversation_id,send_key,company_id)
 select c.id,'b1830000-0000-0000-0000-000000000001',c.company_id from public.conversations c where c.good_morning is not null and c.person_id='20000000-0000-0000-0000-000000000003';
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile,created_at)
 select 'c1000000-0000-0000-0000-000000000181','b1830000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',a.connection_id,'20000000-0000-0000-0000-000000000005',a.id,'Hello',a.profile,now()
 from public.hermes_agents a where a.id='e1000000-0000-0000-0000-000000000181';
insert into public.conversation_run_notes(conversation_id,send_key,company_id) values ('c1000000-0000-0000-0000-000000000181','b1830000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');
set local session_replication_role=origin;
select is(public.pin_run_history((select id from public.conversations where good_morning is not null and person_id='20000000-0000-0000-0000-000000000003'),'b1830000-0000-0000-0000-000000000001'),
 '[{"role":"assistant","content":"Good morning, team."}]'::jsonb,'the first reply in a morning Conversation carries its greeting');
select is(public.pin_run_history((select id from public.conversations where good_morning is not null and person_id='20000000-0000-0000-0000-000000000003'),'b1830000-0000-0000-0000-000000000001'),
 '[{"role":"assistant","content":"Good morning, team."}]'::jsonb,'and a retry the same');
select is(public.pin_run_history('c1000000-0000-0000-0000-000000000181','b1830000-0000-0000-0000-000000000002'),null,'a Conversation the morning did not open carries none');

-- An item on a Card of an Agent the Manager does not see is no reason to send them a morning: their card would not show it.
set local session_replication_role=replica;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c1000000-0000-0000-0000-000000000182','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000182','Ads');
-- Written past the triggers, so the row carries its status as well as its stage (#676).
insert into public.work_cards(id,company_id,stage_id,status,title,board_order,conversation_id,agent_id) overriding system value
 values (918301,'10000000-0000-0000-0000-000000000001',(select min(id) from public.work_stages where company_id='10000000-0000-0000-0000-000000000001'),'ideas','Ads card',1,'c1000000-0000-0000-0000-000000000182','e1000000-0000-0000-0000-000000000182');
insert into public.waiting_items(company_id,person_id,kind,title,card_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','question','On the Ads card',918301);
set local session_replication_role=origin;
select is(public.record_good_morning('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000181','local-0004','2026-11-14','2026-11-14T07:00:00Z','Morning.','[]'::jsonb),
 2,'the Members something they may see waits on get the morning: the Owner, with the seed''s approvals, and the Contributor 5');
select ok(not exists(select 1 from public.conversations c join public.good_mornings g on g.id=c.good_morning where g.session_id='local-0004' and c.person_id='20000000-0000-0000-0000-000000000002'),
 'the Manager, whose only item is on a Card of an Agent hidden from them, gets none');
-- A mention still open in a team channel the Viewer has left is no reason either: their own read of "Waiting on you"
-- drops it (waiting_items_read), and each Member's part is decided under the very policies of their own read.
set local session_replication_role=replica;
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('e1830000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','team','launch','20000000-0000-0000-0000-000000000001','e1837000-0000-0000-0000-000000000001');
insert into public.channel_messages(id,company_id,channel_id,author,person_id,author_name,body,send_key) overriding system value values
 (-1831,'10000000-0000-0000-0000-000000000001','e1830000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','@Viewer look',gen_random_uuid());
insert into public.waiting_items(company_id,person_id,kind,title,channel_message_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','mention','Omar mentioned you',-1831);
set local session_replication_role=origin;
select is(public.record_good_morning('10000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000181','local-0005','2026-11-15','2026-11-15T07:00:00Z','Morning.','[]'::jsonb),
 2,'the same two Members get the morning');
select ok(not exists(select 1 from public.conversations c join public.good_mornings g on g.id=c.good_morning where g.session_id='local-0005' and c.person_id='20000000-0000-0000-0000-000000000004'),
 'the Viewer, whose only item is a mention in a channel they are not in, gets none');
select * from finish();
rollback;
