begin;
create extension if not exists pgtap with schema extensions;
select plan(64);
-- #674 (spec #667). A person archives and restores their own Conversations. RS Learning's Ari is shown to the Manager
-- (…02), a Contributor (…03) and the Viewer (…04). The Manager has "Plans" (tied to the "Plans card" Card, its session
-- named in the Engine), "Busy" (its Run is open, a turn waits behind it, and the Run asks a question, a permission and
-- hands a step), "Quiet" and "Later"; the Contributor has "Theirs"; the Viewer has "Seen".
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6740000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c6740000-0000-0000-0000-000000000001','Ari','Writes the posts.',false,'archive-chat');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',p,'a6740000-0000-0000-0000-000000000001'
 from unnest(array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[]) p;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values
 ('e6740000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a6740000-0000-0000-0000-000000000001','Ari','session-plans'),
 ('e6740000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a6740000-0000-0000-0000-000000000001','Ari','session-busy'),
 ('e6740000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a6740000-0000-0000-0000-000000000001','Ari',null),
 ('e6740000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a6740000-0000-0000-0000-000000000001','Ari',null),
 ('e6740000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a6740000-0000-0000-0000-000000000001','Ari','session-theirs'),
 ('e6740000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a6740000-0000-0000-0000-000000000001','Ari',null);
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,agent_id,body,send_key,run_id,created_at) values
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000002','مدير',null,'Plans','e6741000-0000-0000-0000-000000000001','plans-run','2026-11-01 09:00Z'),
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000001','agent',null,'Ari','a6740000-0000-0000-0000-000000000001','The plan',null,'plans-run','2026-11-01 09:01Z'),
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000002','مدير',null,'Busy','e6741000-0000-0000-0000-000000000002','busy-run','2026-11-02 09:00Z'),
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000002','مدير',null,'Quiet','e6741000-0000-0000-0000-000000000003','quiet-run','2026-11-03 09:00Z'),
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000003','agent',null,'Ari','a6740000-0000-0000-0000-000000000001','Done',null,'quiet-run','2026-11-03 09:01Z'),
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000004','person','20000000-0000-0000-0000-000000000002','مدير',null,'Later','e6741000-0000-0000-0000-000000000004','later-run','2026-11-04 09:00Z'),
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000004','agent',null,'Ari','a6740000-0000-0000-0000-000000000001','Sure',null,'later-run','2026-11-04 09:01Z'),
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000005','person','20000000-0000-0000-0000-000000000003','مراجع',null,'Theirs','e6741000-0000-0000-0000-000000000005','theirs-run','2026-11-05 09:00Z'),
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000006','person','20000000-0000-0000-0000-000000000004','مشاهد',null,'Seen','e6741000-0000-0000-0000-000000000006','seen-run','2026-11-06 09:00Z');
insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message) values
 ('e6740000-0000-0000-0000-000000000002','e6742000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a6740000-0000-0000-0000-000000000001','And the next one');
insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state) values
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000002','busy-run','q1','question','Which offer?','{"question":"Which offer?","choices":[],"multiple":false}','open'),
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000002','busy-run','p1','permission','Publish the draft','{"description":"Publish the draft","command":"publish","choices":["once","deny"]}','open'),
 ('10000000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000002','busy-run','h1','hand','Press Publish','{"app":"WordPress","line":"The draft is ready; you press Publish.","rows":[]}','open');
insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id) values
 ('10000000-0000-0000-0000-000000000001',3,'Plans card','a6740000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001',3,'Later card','a6740000-0000-0000-0000-000000000001','e6740000-0000-0000-0000-000000000004');
create temporary table ids on commit drop as select title,id from public.work_cards where title in ('Plans card','Later card');
grant select on ids to authenticated,service_role;
create function pg_temp.card(title text) returns bigint language sql as $$ select id from ids where ids.title=card.title $$;
create function pg_temp.chat(n int) returns uuid language sql as $$ select ('e6740000-0000-0000-0000-00000000000'||n)::uuid $$;
create function pg_temp.answer(call text) returns text language plpgsql as $$
declare result text;
begin
 execute format('select coalesce(string_agg(x::text,'',''),'''') from (%s) x(x)',call) into result;
 return result;
exception when others then return sqlstate;
end $$;
create function pg_temp.stops(chats uuid[]) returns text language sql as $$
 select coalesce(string_agg(format('%s %s %s',right(s.conversation::text,1),s.kind,coalesce(s.agent,'')),', ' order by s.conversation,s.kind),'')
 from public.conversation_archive_stops('10000000-0000-0000-0000-000000000001',chats) s $$;
create function pg_temp.listed(archived boolean) returns text language sql as $$
 select coalesce(string_agg(right(l.id::text,1),',' order by l.last_at desc,l.id desc),'')
 from public.conversation_list('10000000-0000-0000-0000-000000000001',archived=>archived) l where l.kind='conversation' $$;
create function pg_temp.waits() returns text language sql as $$
 select coalesce(string_agg(x.kind,',' order by x.kind),'') from public.waiting_list('10000000-0000-0000-0000-000000000001') x
 where x.conversation_id='e6740000-0000-0000-0000-000000000002' $$;
grant execute on function pg_temp.card(text),pg_temp.chat(int),pg_temp.answer(text),pg_temp.stops(uuid[]),pg_temp.listed(boolean),pg_temp.waits() to authenticated,service_role;

select ok(not has_function_privilege('anon','public.archive_conversations(uuid,uuid[])','execute')
 and not has_function_privilege('anon','public.restore_conversations(uuid,uuid[])','execute')
 and not has_function_privilege('anon','public.conversation_archive_stops(uuid,uuid[])','execute'),'nobody signed out may archive, restore or ask what stops');
select ok(not has_function_privilege('authenticated','public.conversation_sessions_to_mark()','execute')
 and not has_function_privilege('authenticated','public.conversation_session_marked(uuid,boolean)','execute')
 and has_function_privilege('service_role','public.conversation_sessions_to_mark()','execute'),'only the worker reads and settles the Engine''s marks');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);

-- What stops: only a Conversation with something going on names anything, one line per thing.
select is(pg_temp.stops(array[pg_temp.chat(2),pg_temp.chat(3)]),'2 hand Ari, 2 permission Ari, 2 question Ari, 2 run Ari','the busy Conversation names its Run, its question, its permission and its handed step; the quiet one nothing');
select is(pg_temp.stops(array[pg_temp.chat(5)]),'','another person''s Conversation names nothing');
select is(pg_temp.waits(),'hand,permission,question','its question, its permission request and its handed step wait on its person');

-- Archiving: only the caller's own, each once.
select is(pg_temp.answer($$select public.archive_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(1),pg_temp.chat(2),pg_temp.chat(5),pg_temp.chat(6)])$$),
 'e6740000-0000-0000-0000-000000000001,e6740000-0000-0000-0000-000000000002','the Manager archives their own Conversations, and nobody else''s');
select is(pg_temp.answer($$select public.archive_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(1)])$$),'','one archived already is not archived again');
select is(pg_temp.listed(false),'4,3','the current list leaves them out');
select is(pg_temp.listed(true),'2,1','the archived list holds them, newest message first');
select is(public.conversation_counts('10000000-0000-0000-0000-000000000001'),'{"current":3,"archived":2}'::jsonb,'and each list counts its own');
select is((select count(*)::int from public.conversations where company_id='10000000-0000-0000-0000-000000000001' and archived_at is null),2,
 'the sidebar''s read of current Conversations leaves them out in the database');
select is((select archived_by::text from public.conversations where id=pg_temp.chat(1)),'20000000-0000-0000-0000-000000000002','who archived it is kept');
select is((select string_agg(subject||':'||coalesce(card_id::text,'-')||':'||(details->>'title'),',' order by subject) from public.company_log where action='conversation_archived'),
 'agent:-:Busy,card:'||pg_temp.card('Plans card')||':Plans','each archive is logged where the Conversation''s other events go: on its Card, or for its person alone');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select string_agg(subject,',') from public.company_log where action='conversation_archived'),'card','another Member reads the Card''s row and not the person''s own');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.stops(array[pg_temp.chat(2)]),'','an archived Conversation names nothing more to stop');
select is(pg_temp.waits(),'','and nothing waits on its person any more');
select is((select count(*)::int from public.work_cards where title='Plans card'),1,'its Card is left on the board');

reset role;
select is((select string_agg(kind||':'||state,',' order by kind) from public.reply_cards where conversation_id=pg_temp.chat(2)),'hand:closed,permission:closed,question:closed',
 'the question, the permission and the handed step close unanswered');
select ok((select failed_at is not null from public.conversation_queued_turns where conversation_id=pg_temp.chat(2)),'the turn waiting behind the Run never starts');
select ok(exists(select 1 from public.stopped_runs where conversation_id=pg_temp.chat(2) and run_id='busy-run'),'the open Run is kept as stopped, for the worker to stop in the Engine');
select is((select count(*)::int from public.conversation_messages where conversation_id in (pg_temp.chat(1),pg_temp.chat(2))),3,'nothing written in them is gone');
select is((select archived_at from public.conversations where id=pg_temp.chat(5)),null,'another person''s Conversation is left as it was');

-- The Engine's mark: the worker is told each session to mark and settles it once the Engine took it.
set local role service_role;
select is((select string_agg(right(conversation::text,1)||':'||session||':'||archived::text||':'||coalesce(profile,'-'),',' order by conversation) from public.conversation_sessions_to_mark()),
 '1:session-plans:true:archive-chat,2:session-busy:true:archive-chat','each archived Conversation with an Engine session is to be marked on its Agent''s profile');
select ok(public.conversation_session_marked(pg_temp.chat(1),true),'the worker settles a mark the Engine took');
select ok(not public.conversation_session_marked(pg_temp.chat(3),true),'and none the Conversation no longer wants');
select is((select string_agg(right(conversation::text,1),',') from public.conversation_sessions_to_mark()),'2','a settled mark is not sent again');
reset role;

-- Archiving a Card leaves its Conversation as it was.
set local role authenticated;
select is(pg_temp.answer($$select card from public.archive_cards('10000000-0000-0000-0000-000000000001',array[pg_temp.card('Later card')])$$),pg_temp.card('Later card')::text,'the Manager archives the Card of "Later"');
select is(pg_temp.listed(false),'4,3','"Later" stays a current Conversation');

-- Restoring: only the caller's own.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(pg_temp.answer($$select public.restore_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(1)])$$),'','another person restores nothing of the Manager''s');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.answer($$select public.restore_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(1),pg_temp.chat(3)])$$),'e6740000-0000-0000-0000-000000000001',
 'the Manager restores their archived one; a current one is left as it is');
select is(pg_temp.listed(false),'4,3,1','it is back in the current list');
select is((select archived_by from public.conversations where id=pg_temp.chat(1)),null,'and no longer names who archived it');
select is((select count(*)::int from public.reply_cards where conversation_id=pg_temp.chat(2) and state='open'),0,'restoring starts nothing again');
reset role;
set local role service_role;
select is((select string_agg(right(conversation::text,1)||':'||archived::text,',' order by conversation) from public.conversation_sessions_to_mark()),'1:false,2:true',
 'a restored Conversation''s session is to be unmarked');
reset role;

-- Writing in an archived Conversation brings it back; the Agent's own reply does not.
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,agent_id,body,run_id)
 values('10000000-0000-0000-0000-000000000001',pg_temp.chat(2),'agent',null,'Ari','a6740000-0000-0000-0000-000000000001','A late reply','busy-run');
select ok((select archived_at is not null from public.conversations where id=pg_temp.chat(2)),'a Run closing after the archive writes its reply and leaves it archived');
set local role authenticated;
select is(pg_temp.answer($$select public.archive_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(3),pg_temp.chat(4)])$$),
 'e6740000-0000-0000-0000-000000000003,e6740000-0000-0000-0000-000000000004','the Manager archives two more');
reset role;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values('10000000-0000-0000-0000-000000000001',pg_temp.chat(2),'person','20000000-0000-0000-0000-000000000002','مدير','Back to it',gen_random_uuid(),'busy-run-2');
select is((select archived_at from public.conversations where id=pg_temp.chat(2)),null,'a message sent in it restores it');
insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message)
 values(pg_temp.chat(3),gen_random_uuid(),'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a6740000-0000-0000-0000-000000000001','Queued');
select is((select archived_at from public.conversations where id=pg_temp.chat(3)),null,'a message queued in it restores it');
insert into public.conversation_notes(company_id,conversation_id,person_id,author_name,addressed_to,addressed_name,body,send_key)
 values('10000000-0000-0000-0000-000000000001',pg_temp.chat(4),'20000000-0000-0000-0000-000000000002','مدير','20000000-0000-0000-0000-000000000001','عمر','@عمر look',gen_random_uuid());
select is((select archived_at from public.conversations where id=pg_temp.chat(4)),null,'a message to a person in it restores it');

-- The Viewer archives their own; someone outside the Company, or nobody signed in, is refused.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is(pg_temp.answer($$select public.archive_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(6)])$$),'e6740000-0000-0000-0000-000000000006','the Viewer archives their own Conversation');
select is(pg_temp.answer($$select public.restore_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(6)])$$),'e6740000-0000-0000-0000-000000000006','and restores it');
select set_config('request.jwt.claim.sub','b6740000-0000-0000-0000-000000000001',true);
select is(pg_temp.answer($$select public.archive_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(5)])$$),'42501','someone outside the Company is refused');
select is(pg_temp.answer($$select public.restore_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(5)])$$),'42501','for restoring too');
select is(pg_temp.stops(array[pg_temp.chat(2)]),'','and is told nothing of what would stop');
select set_config('request.jwt.claim.sub','',true);
select is(pg_temp.answer($$select public.archive_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(5)])$$),'42501','nobody signed in is refused');
reset role;

-- A message sent or queued before the archive, whose start was on its way when it was archived, lands after it: that
-- is no new writing, so the Conversation stays archived, and its Run is stopped as it lands. The Contributor's "Theirs"
-- has a turn queued behind its Run whose start is on its way; the Manager's "Plans" a direct send on its way.
insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message,queued_at) values
 (pg_temp.chat(5),'e6742000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a6740000-0000-0000-0000-000000000001','Queued before','2026-11-05 09:05Z');
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile,start_attempts,created_at) values
 (pg_temp.chat(5),'e6742000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','c6740000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a6740000-0000-0000-0000-000000000001','Queued before','archive-chat',1,'2026-11-05 09:05Z'),
 (pg_temp.chat(1),'e6742000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','c6740000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a6740000-0000-0000-0000-000000000001','Sent before','archive-chat',1,'2026-11-01 09:05Z');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(pg_temp.answer($$select public.archive_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(5)])$$),'e6740000-0000-0000-0000-000000000005','the Contributor archives "Theirs"');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.answer($$select public.archive_conversations('10000000-0000-0000-0000-000000000001',array[pg_temp.chat(1)])$$),'e6740000-0000-0000-0000-000000000001','the Manager archives "Plans" again');
reset role;
select ok((select failed_at is null from public.conversation_queued_turns where send_key='e6742000-0000-0000-0000-000000000005'),'the turn whose start is on its way is left to land');
set local role service_role;
select ok(public.record_conversation_turn(pg_temp.chat(5),'e6742000-0000-0000-0000-000000000005','theirs-late-run','c6740000-0000-0000-0000-000000000001'),'the queued turn''s start lands after the archive');
reset role;
select ok((select archived_at is not null from public.conversations where id=pg_temp.chat(5)),'and leaves its Conversation archived');
select ok(exists(select 1 from public.stopped_runs where conversation_id=pg_temp.chat(5) and run_id='theirs-late-run'),'its Run is stopped as it lands');
set local role authenticated;
select ok(public.send_conversation_message(pg_temp.chat(1),'10000000-0000-0000-0000-000000000001','a6740000-0000-0000-0000-000000000001','Sent before',
 'e6742000-0000-0000-0000-000000000006','plans-late-run','c6740000-0000-0000-0000-000000000001'),'the direct send''s record lands after the archive');
reset role;
select ok((select archived_at is not null from public.conversations where id=pg_temp.chat(1)),'and leaves its Conversation archived too');
select ok(exists(select 1 from public.stopped_runs where conversation_id=pg_temp.chat(1) and run_id='plans-late-run'),'its Run is stopped as it lands');

-- A Run stopped before it replied still names its Engine session, so the archived Conversation has a session to mark.
set local role service_role;
select ok(public.close_conversation_run(pg_temp.chat(5),'theirs-late-run','stopped',null,'session-theirs-2',null,null,false),'the stopped Run closes');
reset role;
update public.conversations set hermes_session_id=null where id=pg_temp.chat(4);
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values('10000000-0000-0000-0000-000000000001',pg_temp.chat(4),'person','20000000-0000-0000-0000-000000000002','مدير','One more',gen_random_uuid(),'later-run-2');
set local role service_role;
select ok(public.close_conversation_run(pg_temp.chat(4),'later-run-2','stopped',null,'session-later',null,null,false),'a Run of a Conversation with no session yet closes stopped');
reset role;
select is((select hermes_session_id from public.conversations where id=pg_temp.chat(4)),'session-later','and its Engine session is kept with the Conversation');
set local role service_role;

-- A session the Engine does not keep yet is asked again a minute later, and let go after a day.
select ok(not public.conversation_session_missing(pg_temp.chat(5),true),'a session the Engine does not keep yet is not settled');
select ok(not exists(select 1 from public.conversation_sessions_to_mark() where conversation=pg_temp.chat(5)),'and waits a minute before it is asked again');
reset role;
update public.conversations set session_missing_since=now()-interval '2 days', session_mark_after=null where id=pg_temp.chat(5);
set local role service_role;
select ok(public.conversation_session_missing(pg_temp.chat(5),true),'one missing for a day is settled as it is');
select ok(not exists(select 1 from public.conversation_sessions_to_mark() where conversation=pg_temp.chat(5)),'and is not asked again');
reset role;

-- A mark the Engine took after the Conversation changed is kept as what the Engine holds, so the next pass corrects it:
-- the worker read "Busy" archived, its person restored it, and then the Engine took the archived mark.
-- ("Busy" is made current with its Engine unmarked, as the worker found it after the restore.)
update public.conversations set archived_at=null, archived_by=null, session_archived=false where id=pg_temp.chat(2);
set local role service_role;
select ok(not public.conversation_session_marked(pg_temp.chat(2),true),'the late mark does not settle the restored Conversation');
select ok(exists(select 1 from public.conversation_sessions_to_mark() where conversation=pg_temp.chat(2) and not archived),'and the next pass takes the mark off again');
-- An Engine that does not answer: its marks wait a moment, out of the page, so another Company's are reached.
select public.conversation_sessions_later(array[pg_temp.chat(2)]);
select ok(not exists(select 1 from public.conversation_sessions_to_mark() where conversation=pg_temp.chat(2)),'a mark whose Engine did not answer is put off for the next passes');
reset role;

select * from finish();
rollback;
