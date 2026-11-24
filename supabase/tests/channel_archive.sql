begin;
create extension if not exists pgtap with schema extensions;
select plan(48);
-- #675 (spec #667). RS Learning's seeded Members: the Owner (1), the Manager (2), a Contributor (3), the Viewer (4) and a
-- second Contributor (5). A team channel "spring" holds the Manager, Contributor 3 and the Viewer, with Ads in it; the
-- Owner and Contributor 5 are outside it. Karim is a Manager of Aleem only.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('e6750000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','e6758000-0000-0000-0000-000000000001','Ads','Ads',false,'channel-archive-ads');
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('e6750000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','team','spring','20000000-0000-0000-0000-000000000002','e6757000-0000-0000-0000-000000000001');
insert into public.channel_people(channel_id,company_id,person_id,added_by)
 select 'e6750000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'20000000-0000-0000-0000-000000000002'
 from unnest(array[2,3,4]) n;
insert into public.channel_agents(channel_id,company_id,agent_id,added_by) values
 ('e6750000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','e6750000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
insert into auth.users(id,email) values ('e6759000-0000-0000-0000-000000000001','karim.archive@example.test');
insert into public.people(id,name) values ('e6759000-0000-0000-0000-000000000001','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','e6759000-0000-0000-0000-000000000001','manager');

-- Open work in the channel: a Run started (it asks a question and a request), a Run not started yet, a handed step,
-- and a Member's mention waiting on Contributor 3.
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','e6750000-0000-0000-0000-000000000011','person','20000000-0000-0000-0000-000000000002','مدير','@Ads which angle?','e6751000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','e6750000-0000-0000-0000-000000000011','person','20000000-0000-0000-0000-000000000002','مدير','@Ads write it','e6751000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000001','e6750000-0000-0000-0000-000000000011','person','20000000-0000-0000-0000-000000000003','مراجع','@Ads hand me the publish','e6751000-0000-0000-0000-000000000003');
select set_config('test.asks',(select id::text from public.channel_messages where send_key='e6751000-0000-0000-0000-000000000001'),true);
select set_config('test.later',(select id::text from public.channel_messages where send_key='e6751000-0000-0000-0000-000000000002'),true);
select set_config('test.hand',(select id::text from public.channel_messages where send_key='e6751000-0000-0000-0000-000000000003'),true);
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at)
 select id,1,company_id,channel_id,'e6750000-0000-0000-0000-000000000001','Ads',gen_random_uuid(),body,
  case send_key when 'e6751000-0000-0000-0000-000000000001' then 'run-asks' else 'run-hand' end,'channel-archive-ads',1,now()
 from public.channel_messages where send_key in ('e6751000-0000-0000-0000-000000000001','e6751000-0000-0000-0000-000000000003');
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input)
 select id,1,company_id,channel_id,'e6750000-0000-0000-0000-000000000001','Ads',gen_random_uuid(),body
 from public.channel_messages where send_key='e6751000-0000-0000-0000-000000000002';
insert into public.waiting_items(company_id,person_id,kind,title,body,asked_by,channel_message_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','channel_mention','spring','@مراجع look','مدير',current_setting('test.later')::bigint);
set local role service_role;
select is(public.track_channel_question(current_setting('test.asks')::bigint,'run-asks','{"id":"q-a","text":"Which angle first?","choices":["One","Two"],"multiple":false}'::jsonb,false,now())::text,'[]','the started Run asks a question');
select is(public.track_channel_permission(current_setting('test.asks')::bigint,'run-asks','{"id":"p-a","description":"delete the exports","command":"rm -r exports","choices":["once","deny"]}'::jsonb,false,now())::text,'[]','and asks to be allowed something');
select is(public.channel_show_card(current_setting('test.hand')::bigint,'run-hand','call-hand','hand','Publish the article',
 '{"app":"WordPress","line":"The draft is ready","rows":[]}'::jsonb)->>'state','shown','the other Run hands a step to the team');
reset role;
update public.channel_runs set outcome='completed', closed_at=now() where run_id='run-hand';

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

-- What the confirmation names, for a Member who may archive: the Run working, the Run waiting its turn, the question,
-- the request and the handed step.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind in ('channel_question','channel_hand','channel_mention')),3,
 'Contributor 3 waits on the question, the handed step and their mention');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select array_agg(kind||':'||agent||':'||title order by kind,title) from public.channel_archive_stops('e6750000-0000-0000-0000-000000000011')),
 array['hand:Ads:Publish the article','permission:Ads:delete the exports','question:Ads:Which angle first?','run:Ads:'],
 'the confirmation names the Agent working, the question, the request and the handed step');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is_empty($$select * from public.channel_archive_stops('e6750000-0000-0000-0000-000000000011')$$,'a Member outside the channel is told nothing of it');

-- Who may archive.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select * from public.archive_channel('69000000-0000-0000-0000-000000000001')$$,'42501','channelArchiveNotAllowed','the general channel is never archived, by the Owner either');
select throws_ok($$select * from public.archive_channel('e6750000-0000-0000-0000-000000000011')$$,'P0002','channelNotFound','the Owner outside a team channel finds no channel');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select * from public.archive_channel('e6750000-0000-0000-0000-000000000011')$$,'42501','channelArchiveNotAllowed','a Contributor in it may not archive it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select * from public.archive_channel('e6750000-0000-0000-0000-000000000011')$$,'42501','channelArchiveNotAllowed','nor may the Viewer');
select set_config('request.jwt.claim.sub','e6759000-0000-0000-0000-000000000001',true);
select throws_ok($$select * from public.archive_channel('e6750000-0000-0000-0000-000000000011')$$,'P0002','channelNotFound','another Company''s Manager finds no channel');

-- The Manager in it archives it: the started Run is answered to stop on its Agent's Engine, the one not started ends.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select array_agg(run||':'||profile) from public.archive_channel('e6750000-0000-0000-0000-000000000011')),array['run-asks:channel-archive-ads'],
 'the Manager archives it, and the Run working is the one to stop on its Engine');
select is((select outcome from public.channel_runs where message_id=current_setting('test.later')::bigint),'stopped','the Run not started yet ends as stopped');
select is((select archived_by::text from public.channels where id='e6750000-0000-0000-0000-000000000011'),'20000000-0000-0000-0000-000000000002','the channel keeps who archived it');
select ok((select archived_at is not null from public.channels where id='e6750000-0000-0000-0000-000000000011'),'and when');
select is_empty($$select * from public.archive_channel('e6750000-0000-0000-0000-000000000011')$$,'archiving it again changes nothing');
select is((select state from public.reply_cards where channel_message_id=current_setting('test.asks')::bigint and kind='question'),'closed','its question closes unanswered');
select is((select state from public.channel_permissions where message_id=current_setting('test.asks')::bigint),'closed','its request closes undecided');
select is_empty($$select * from public.channel_archive_stops('e6750000-0000-0000-0000-000000000011')$$,'nothing is left to name');

-- The Run working closes later, as stopped, through its own close: its end is kept and the channel stays archived.
set local role service_role;
select ok(public.close_channel_run(current_setting('test.asks')::bigint,'run-asks','stopped',null,null,null),'the Run working closes later as stopped');
set local role authenticated;
select ok((select archived_at is not null from public.channels where id='e6750000-0000-0000-0000-000000000011'),'and the channel stays archived');

-- Its Members read it under Archived and write nothing; nobody waits on it.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is_empty($$select * from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind in ('channel_question','channel_hand','channel_mention','channel_permission')$$,
 'nobody waits on the archived channel any more');
select is((select array_agg(kind order by kind) from public.channel_sidebar('10000000-0000-0000-0000-000000000001')),array['general'],'it leaves its Members'' channel list, with its unread count');
select is((select array_agg(name||':'||archived_by_name) from public.archived_channels('10000000-0000-0000-0000-000000000001')),array['spring:مدير'],'its Members find it under Archived, with who archived it');
select is((select count(*)::int from public.channel_messages where channel_id='e6750000-0000-0000-0000-000000000011'),3,'and read every message in it');
select is((select archived_by::text from public.channels where id='e6750000-0000-0000-0000-000000000011'),'20000000-0000-0000-0000-000000000002','reading it says it is archived');
select throws_ok($$select public.post_channel_message('e6750000-0000-0000-0000-000000000011','e6751000-0000-0000-0000-000000000009','one more')$$,'42501','channelArchived','a Member cannot write in it');
select is(public.answer_channel_question('10000000-0000-0000-0000-000000000001','e6750000-0000-0000-0000-000000000011',
 (select id from public.reply_cards where channel_message_id=current_setting('test.asks')::bigint and kind='question'),0,null,gen_random_uuid()),'closed','nor answer its question');
select throws_ok($$select public.mark_channel_hand_done('10000000-0000-0000-0000-000000000001','e6750000-0000-0000-0000-000000000011',
 (select id from public.reply_cards where channel_message_id=current_setting('test.hand')::bigint and kind='hand'))$$,'42501','channelArchived','nor mark its handed step done');
select is((select count(*)::int from public.company_log where action='channel_archived' and details->>'channel_id'='e6750000-0000-0000-0000-000000000011'),1,
 'its Members read one Activity log row of the archive');
select is((select actor_id::text||':'||actor_name||':'||(details->>'channel') from public.company_log where action='channel_archived'),'20000000-0000-0000-0000-000000000002:مدير:spring','with who archived it and the channel''s name');

-- Outside Members see nothing of it, the Owner included.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is_empty($$select * from public.archived_channels('10000000-0000-0000-0000-000000000001')$$,'a Member outside it finds nothing under Archived');
select is_empty($$select * from public.company_log where action in ('channel_archived','channel_restored')$$,'and no log row of it');
select is_empty($$select * from public.channels where id='e6750000-0000-0000-0000-000000000011'$$,'and no channel');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is_empty($$select * from public.archived_channels('10000000-0000-0000-0000-000000000001')$$,'nor does the Owner outside it');
select is_empty($$select * from public.company_log where action in ('channel_archived','channel_restored')$$,'who reads no log row of it either');
select throws_ok($$select public.restore_channel('e6750000-0000-0000-0000-000000000011')$$,'P0002','channelNotFound','and cannot restore it');
select set_config('request.jwt.claim.sub','e6759000-0000-0000-0000-000000000001',true);
select is_empty($$select * from public.archived_channels('10000000-0000-0000-0000-000000000001')$$,'another Company''s Manager reads nothing');

-- Restoring: only an Owner or a Manager in it; nothing starts.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.restore_channel('e6750000-0000-0000-0000-000000000011')$$,'42501','channelRestoreNotAllowed','a Contributor in it may not restore it');
select throws_ok($$select public.restore_channel('69000000-0000-0000-0000-000000000001')$$,'42501','channelRestoreNotAllowed','the general channel has nothing to restore');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.restore_channel('e6750000-0000-0000-0000-000000000011')$$,'the Manager restores it');
select lives_ok($$select public.restore_channel('e6750000-0000-0000-0000-000000000011')$$,'restoring it again changes nothing');
select ok((select archived_at is null and archived_by is null from public.channels where id='e6750000-0000-0000-0000-000000000011'),'it is current again');
select is((select count(*)::int from public.company_log where action='channel_restored' and actor_id='20000000-0000-0000-0000-000000000002'),1,'with one log row naming who restored it');
reset role;
select is((select count(*)::int from public.channel_runs where channel_id='e6750000-0000-0000-0000-000000000011' and outcome is null and run_id is null),0,'and no Run starts by itself');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select array_agg(kind order by kind) from public.channel_sidebar('10000000-0000-0000-0000-000000000001')),array['general','team'],'it is back in its Members'' channel list');
select is_empty($$select * from public.archived_channels('10000000-0000-0000-0000-000000000001')$$,'and out of Archived');
select ok(public.post_channel_message('e6750000-0000-0000-0000-000000000011','e6751000-0000-0000-0000-000000000010','we are back') is not null,'its Members write in it again');

reset role;
select * from finish();
rollback;
