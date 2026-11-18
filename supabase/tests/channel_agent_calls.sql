begin;
create extension if not exists pgtap with schema extensions;
select plan(59);
-- #152. RS Learning's seeded Members: the Owner (1), the Manager (2), a Contributor (3) and the Viewer (4). Lead is the
-- main Agent, seen by everyone; Faye is shown to the Manager and the Contributor, and SEO, Reach and Lead Writer to the
-- Contributor only; Secret is shown to nobody but the Owner. The general channel is 69000000-0000-0000-0000-000000000001.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,instructions,profile) values
 ('a2500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000001','Lead','General',true,null,'channel-calls-test'),
 ('a2500000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000002','Faye','Marketing',false,'Write short.','channel-calls-test'),
 ('a2500000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000003','SEO','Articles',false,'Write long.','channel-calls-test'),
 ('a2500000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000004','Reach','Outreach',false,null,'channel-calls-test'),
 ('a2500000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000005','Lead Writer','Copy',false,null,'channel-calls-test'),
 ('a2500000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','f2500000-0000-0000-0000-000000000006','Secret','Hidden',false,null,'channel-calls-test');
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a2500000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2500000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2500000-0000-0000-0000-000000000003'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2500000-0000-0000-0000-000000000004'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2500000-0000-0000-0000-000000000005');
insert into auth.users(id,email) values ('b2500000-0000-0000-0000-000000000001','karim.calls@example.test');
insert into public.people(id,name) values ('b2500000-0000-0000-0000-000000000001','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','b2500000-0000-0000-0000-000000000001','manager');
create temporary table sent(label text, id bigint) on commit drop;
grant select, insert on sent to authenticated, service_role;

-- The calling rule: every Agent the message names, up to three, each once, in the order named.
select is((select array_agg(h.name||':'||m.ordinal order by m.ordinal) from public.channel_mentions_in('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','@Faye @SEO we need two scripts') m join public.hermes_agents h on h.id=m.agent),
 array['Faye:1','SEO:2'],'a message that calls two Agents calls both, in the order they were named');
select is((select array_agg(h.name||':'||m.ordinal order by m.ordinal) from public.channel_mentions_in('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','@Faye @SEO @Reach go, @Lead Writer, and @Lead too') m join public.hermes_agents h on h.id=m.agent),
 array['Faye:1','SEO:2','Reach:3'],'a message that names five calls the first three it names, and no more');
select is((select array_agg(h.name||':'||m.ordinal order by m.ordinal) from public.channel_mentions_in('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','@Lead Writer draft the teaser') m join public.hermes_agents h on h.id=m.agent),
 array['Lead Writer:1'],'at one place the longest name is the one called, not a second Agent too');
select is((select array_agg(h.name||':'||m.ordinal order by m.ordinal) from public.channel_mentions_in('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','@Faye @SEO then @Faye again, @SEO too') m join public.hermes_agents h on h.id=m.agent),
 array['Faye:1','SEO:2'],'a name repeated in one message calls its Agent once');
select is((select count(*)::int from public.channel_mentions_in('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','@مدير شوف ده')),0,'a Member''s name calls nobody');
select is((select count(*)::int from public.channel_mentions_in('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','Morning all')),0,'ordinary talk calls nobody');
select is((select count(*)::int from public.channel_mentions_in('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','write to x@faye.com')),0,'an address calls nobody');
select is((select array_agg(h.name||':'||m.ordinal order by m.ordinal) from public.channel_mentions_in('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','@Secret @Faye look at this') m join public.hermes_agents h on h.id=m.agent),
 array['Faye:1'],'an Agent hidden from the sender is not called, and the others named in the same message are');
select is((select array_agg(h.name||':'||m.ordinal order by m.ordinal) from public.channel_mentions_in('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','@Secret @Faye look at this') m join public.hermes_agents h on h.id=m.agent),
 array['Secret:1','Faye:2'],'the Owner, who sees every Agent, calls the hidden one too');
select is((select array_agg(h.name||':'||m.ordinal order by m.ordinal) from public.channel_mentions_in('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','@Reach @Faye hello') m join public.hermes_agents h on h.id=m.agent),
 array['Faye:1'],'a Manager calls the Agents the channel shows them, and none it does not');
select is(public.channel_mention_in('69000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','@Faye @SEO plan'),'a2500000-0000-0000-0000-000000000002'::uuid,'one Ask returns the first Agent named');

-- A message posted with two names starts one Run for each, in the order named, each with its own session and rules.
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into sent values ('two',public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Faye @SEO we need two scripts'));
reset role;
select is((select array_agg(r.ordinal||':'||r.agent_name order by r.ordinal) from public.channel_runs r where r.message_id=(select id from sent where label='two')),
 array['1:Faye','2:SEO'],'a message that calls two Agents starts two Runs, in the order named');
select is((select count(distinct r.session)::int from public.channel_runs r where r.message_id=(select id from sent where label='two')),2,'each Run has its own session');
select is((select array_agg(r.input order by r.ordinal) from public.channel_runs r where r.message_id=(select id from sent where label='two')),
 array['مراجع: @Faye @SEO we need two scripts','مراجع: @Faye @SEO we need two scripts'],'each Agent reads the Member''s message, with its writer''s first name');
select is((select array_agg(r.instructions order by r.ordinal) from public.channel_runs r where r.message_id=(select id from sent where label='two')),
 array['Write short.','Write long.'],'each Agent has its own instructions pinned with its Run');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into sent values ('four',public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Faye @SEO @Reach @Lead Writer all four'));
insert into sent values ('hidden',public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Secret @Faye look'));
insert into sent values ('repeat',public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Faye @Faye again'));
reset role;
select is((select array_agg(r.ordinal||':'||r.agent_name order by r.ordinal) from public.channel_runs r where r.message_id=(select id from sent where label='four')),
 array['1:Faye','2:SEO','3:Reach'],'a message that names four Agents starts three Runs, and the fourth is not called');
select is((select array_agg(r.agent_name order by r.ordinal) from public.channel_runs r where r.message_id=(select id from sent where label='hidden')),
 array['Faye'],'an Agent hidden from the sender gets no Run, and the other Agent named in the same message does');
select is((select count(*)::int from public.channel_runs where message_id=(select id from sent where label='repeat')),1,'a name repeated in one message starts one Run');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Faye @SEO write')$$,'42501','channelNotAllowed','a Viewer''s message is refused, and starts no Run');

-- One after another: the second Run is not due until the first has ended, and a start driven twice starts one Run.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into sent values ('repeat key',public.post_channel_message('69000000-0000-0000-0000-000000000001','c2500000-0000-0000-0000-000000000001','@Faye @SEO again'));
insert into sent values ('same key',public.post_channel_message('69000000-0000-0000-0000-000000000001','c2500000-0000-0000-0000-000000000001','@Faye @SEO again'));
reset role;
select is((select id from sent where label='repeat key'),(select id from sent where label='same key'),'a repeated send key is the same message');
select is((select count(*)::int from public.channel_runs where message_id=(select id from sent where label='repeat key')),2,'and starts no second Run for either Agent');
set local role service_role;
select is((select array_agg(ordinal order by ordinal) from public.channel_runs_due(null,(select id from sent where label='two'),0)),
 array[1]::smallint[],'only the first Agent''s Run is due while the message''s Runs are open');
select is((select array_agg(ordinal order by ordinal) from public.channel_runs_due(null,(select id from sent where label='two'),0)),
 array[1]::smallint[],'a second driver at the same moment is given the same Run, never the second Agent''s');
select is((select attempt from public.begin_channel_start((select id from sent where label='two'))),1,'the first attempt of the first Run');
select is((select attempt from public.begin_channel_start((select id from sent where label='two'))),2,'a resend is a second attempt of the same Run');
select is((select count(*)::int from public.channel_runs_due(null,(select id from sent where label='two'),0)),1,'and still only one Run is due');
select is((select count(*)::int from public.channel_runs_due(null,null,0) where message=(select id from sent where label='two') and ordinal=2),0,'the second Agent''s Run is never sent before the first has ended');
select ok(public.answer_channel_start((select id from sent where label='two'),2,'run-two-1'),'the first Run''s engine run id is recorded once');
select ok(public.close_channel_run((select id from sent where label='two'),'run-two-1','completed','Here are the first scripts.',null,null),'the first Agent''s Run ends');
select is((select array_agg(ordinal order by ordinal) from public.channel_runs_due(null,(select id from sent where label='two'),0)),array[2]::smallint[],'then the second Agent''s Run is due');
select is((select attempt from public.begin_channel_start((select id from sent where label='two'))),1,'the second Run is started for the first time');
select ok(public.answer_channel_start((select id from sent where label='two'),1,'run-two-2'),'with its own engine run id');
select ok(public.close_channel_run((select id from sent where label='two'),'run-two-2','completed','And here are the second.',null,null),'and it ends too');
reset role;
select is((select array_agg(m.reply_ordinal||':'||m.author_name||':'||m.body order by m.reply_ordinal) from public.channel_messages m where m.reply_to=(select id from sent where label='two')),
 array['1:Faye:Here are the first scripts.','2:SEO:And here are the second.'],'each Agent''s reply is posted once, under its own place, in the order named');
select is((select array_agg(reply_ordinal||':'||author_name order by reply_ordinal) from public.channel_messages where reply_to=(select id from sent where label='four')),null::text[],'a message whose Agents have not answered has no reply');

-- A failed first Run does not stop the others: its own place answers "could not", and the next Agent still replies.
set local role service_role;
select ok(public.close_channel_run((select id from sent where label='four'),null,'failed',null,null,null),'the first Agent of the message could not reply');
select is((select array_agg(ordinal order by ordinal) from public.channel_runs_due(null,(select id from sent where label='four'),0)),array[2]::smallint[],'the next Agent''s Run is still due');
select is((select attempt from public.begin_channel_start((select id from sent where label='four'))),1,'and is started');
select ok(public.answer_channel_start((select id from sent where label='four'),1,'run-four-2'),'with its own engine run id');
select ok(public.close_channel_run((select id from sent where label='four'),'run-four-2','completed','The second Agent''s answer.',null,null),'it replies');
reset role;
select is((select array_agg(reply_ordinal||':'||author_name||':'||body order by reply_ordinal) from public.channel_messages where reply_to=(select id from sent where label='four')),
 array['2:SEO:The second Agent''s answer.'],'the other Agent''s reply stands, and the failed one has its own unanswered place');
select is((select array_agg(outcome order by ordinal) from public.channel_runs where message_id=(select id from sent where label='four')),
 array['failed','completed',null]::text[],'the first Run failed, the second answered anyway, and the third was never started behind it');

-- #148 per Run: tools pinned on the Run being started, a card kept per Run, and a reply's steps read from its own session.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into sent values ('pin',public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Faye @SEO draft and review'));
reset role;
select set_config('test.specs','{"show_draft":"{\"name\":\"show_draft\"}","show_review":"{\"name\":\"show_review\"}"}',true);
set local role service_role;
select ok(public.pin_channel_run((select id from sent where label='pin'),current_setting('test.specs')::jsonb)->>'tools' like '%"show_draft"%','the Run being started is offered its tools');
reset role;
select is((select array_agg(ordinal order by ordinal) from public.channel_runs where message_id=(select id from sent where label='pin') and tools is not null),
 array[1]::smallint[],'and only that Run''s tools are pinned, never the second Agent''s');
select set_config('test.draft','{"line":"مسودة · Meta Ads","rows":[{"label":"Scripts","value":"3"}]}',true);
set local role service_role;
select is(public.channel_show_card((select id from sent where label='two'),'run-two-1','call-1','draft','First draft',current_setting('test.draft')::jsonb)->>'state','shown','the first Run''s draft card is kept');
select is(public.channel_show_card((select id from sent where label='two'),'run-two-2','call-1','draft','Second draft',current_setting('test.draft')::jsonb)->>'state','shown','the second Run''s card is a card of its own, even with the same call id');
reset role;
select is((select array_agg(title order by title) from public.reply_cards where channel_message_id=(select id from sent where label='two')),
 array['First draft','Second draft'],'one card per Run under the same message');
-- Each reply's session is read as the channel member, compared with the pairs the database holds (which that member
-- cannot read directly: a Run's connection and session stay the worker's).
create temporary table expected_sessions(session uuid, reply bigint) on commit drop;
insert into expected_sessions select r.session,m.id from public.channel_runs r
 join public.channel_messages m on m.reply_to=r.message_id and m.reply_ordinal=r.ordinal
 where r.message_id=(select id from sent where label='two');
grant select on expected_sessions to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.channel_run_sessions('69000000-0000-0000-0000-000000000001') where message_id=(select id from sent where label='two')),2,'a member reads one session per reply of the message');
select results_eq($$select s.session,s.reply from public.channel_run_sessions('69000000-0000-0000-0000-000000000001') s where s.message_id=(select id from sent where label='two') order by s.reply$$,
 $$select e.session,e.reply from expected_sessions e order by e.reply$$,
 'each reply reads the steps of its own Agent''s session');
select set_config('request.jwt.claim.sub','b2500000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.channel_run_sessions('69000000-0000-0000-0000-000000000001') where message_id=(select id from sent where label='two')),0,'and a Member of another Company reads no session');

-- #165 per Run: a request belongs to the Run that asked, and one Run's end closes only its own.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into sent values ('perm',public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Faye @SEO clean the exports'));
reset role;
set local role service_role;
select is((select count(*)::int from public.begin_channel_start((select id from sent where label='perm'))),1,'the first Agent''s Run starts');
select ok(public.answer_channel_start((select id from sent where label='perm'),1,'run-perm-1'),'with its engine run id');
select is(public.track_channel_permission((select id from sent where label='perm'),'run-perm-1','{"id":"a1","description":"delete the exports","command":"rm -r exports","choices":["once","deny"]}'::jsonb,false,now())::text,'[]','the first Run''s request is kept');
select ok(public.close_channel_run((select id from sent where label='perm'),'run-perm-1','completed','Cleaned them.',null,null),'the first Run ends');
select is((select count(*)::int from public.begin_channel_start((select id from sent where label='perm'))),1,'the second Agent''s Run starts');
select ok(public.answer_channel_start((select id from sent where label='perm'),1,'run-perm-2'),'with its own engine run id');
select is(public.track_channel_permission((select id from sent where label='perm'),'run-perm-2','{"id":"b1","description":"delete the backups","command":"rm -r backups","choices":["once","deny"]}'::jsonb,false,now())::text,'[]','and its request is kept too');
reset role;
select is((select array_agg(ordinal||':'||state order by ordinal) from public.channel_permissions where message_id=(select id from sent where label='perm')),
 array['1:closed','2:open'],'each request is under its own Agent''s place, and only the ended Run''s request closed');
select is((select array_agg(run_id order by ordinal) from public.channel_permissions where message_id=(select id from sent where label='perm')),
 array['run-perm-1','run-perm-2'],'each request is linked to the Run that asked, not to the message alone');

select * from finish();
rollback;
