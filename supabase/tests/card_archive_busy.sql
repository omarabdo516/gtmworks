begin;
create extension if not exists pgtap with schema extensions;
select plan(42);
-- #671 (spec #667). Archiving a Card an Agent works on, or that waits on someone. RS Learning's Busy Agent is shown to
-- the Manager (…02), the first Contributor (…03) and the Viewer (…04), and hidden from the second Contributor (…05).
-- "Busy chat" is tied to the first Contributor's chat with Busy: its Run is open, a turn waits behind it, and the Run
-- asks a question, a permission and hands a step. "Busy note" has two notes that called Busy: one Run not started yet,
-- one running. "Busy approval" waits on the Manager's approval. "Busy room" is the "busy room" team channel's Card: one
-- Run running there, with a question and a permission, and one not started. "Busy idle" has nothing going on.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6710000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c6710000-0000-0000-0000-000000000001','Busy','Writes the posts.',false,'archive-busy');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',p,'a6710000-0000-0000-0000-000000000001'
 from unnest(array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[]) p;
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e6710000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a6710000-0000-0000-0000-000000000001','Busy');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','e6710000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','Write the June post',gen_random_uuid(),'busy-chat-run');
insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message) values
 ('e6710000-0000-0000-0000-000000000001','e6711000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a6710000-0000-0000-0000-000000000001','And the July one');
insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state) values
 ('10000000-0000-0000-0000-000000000001','e6710000-0000-0000-0000-000000000001','busy-chat-run','q1','question','Which offer?','{"question":"Which offer?","choices":[],"multiple":false}','open'),
 ('10000000-0000-0000-0000-000000000001','e6710000-0000-0000-0000-000000000001','busy-chat-run','p1','permission','Publish the draft','{"description":"Publish the draft","command":"publish","choices":["once","deny"]}','open'),
 ('10000000-0000-0000-0000-000000000001','e6710000-0000-0000-0000-000000000001','busy-chat-run','h1','hand','Press Publish','{"app":"WordPress","line":"The draft is ready; you press Publish.","rows":[]}','open');
-- A choice the Contributor made on an earlier request, not delivered to the Engine yet.
insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,decided_by,decided_at) values
 ('10000000-0000-0000-0000-000000000001','e6710000-0000-0000-0000-000000000001','busy-chat-run','p0','permission','Read the stats','{"description":"Read the stats","command":"stats","choices":["once","deny"],"choice":"once"}','sending','20000000-0000-0000-0000-000000000003',now());
-- A second turn whose start is on its way to the Engine (its reservation was tried once).
insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message) values
 ('e6710000-0000-0000-0000-000000000001','e6711000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a6710000-0000-0000-0000-000000000001','And the August one');
insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile,start_attempts) values
 ('e6710000-0000-0000-0000-000000000001','e6711000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','c6710000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a6710000-0000-0000-0000-000000000001','And the August one','archive-busy',1);
insert into public.work_cards(company_id,status,title,agent_id,conversation_id)
 select '10000000-0000-0000-0000-000000000001','progress',x.title,x.agent::uuid,x.conversation::uuid
 from (values ('Busy chat','a6710000-0000-0000-0000-000000000001','e6710000-0000-0000-0000-000000000001'),('Busy note',null,null),('Busy approval',null,null),('Busy idle',null,null)) x(title,agent,conversation);
insert into public.work_comments(company_id,card_id,author_id,body)
 select company_id,id,'20000000-0000-0000-0000-000000000002',x.body from public.work_cards, (values ('Draft the hook'),('Check the caption'),('Mind the length')) x(body) where title='Busy note';
insert into public.note_runs(note_id,company_id,card_id,agent_id,agent_name,session,input,attempts,attempted_at,run_id,profile)
 select n.id,n.company_id,n.card_id,'a6710000-0000-0000-0000-000000000001','Busy',gen_random_uuid(),n.body,
  case when n.body in ('Check the caption','Mind the length') then 1 else 0 end,case when n.body in ('Check the caption','Mind the length') then now() end,
  case when n.body='Check the caption' then 'busy-note-run' end,case when n.body in ('Check the caption','Mind the length') then 'archive-busy' end
 from public.work_comments n join public.work_cards w on w.id=n.card_id where w.title='Busy note';
insert into public.waiting_items(company_id,person_id,kind,title,card_id,note_id)
 select n.company_id,'20000000-0000-0000-0000-000000000002','mention','Busy note',n.card_id,n.id from public.work_comments n where n.body='Draft the hook';
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('e6712000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','team','Busy room','20000000-0000-0000-0000-000000000003','e6712000-0000-0000-0000-000000000009');
insert into public.channel_people(channel_id,company_id,person_id,added_by) values
 ('e6712000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003');
insert into public.channel_agents(channel_id,company_id,agent_id,added_by) values
 ('e6712000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a6710000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003');
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','e6712000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','@Busy plan the week','e6713000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','e6712000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','@Busy and the month','e6713000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000001','e6712000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','@Busy then the year','e6713000-0000-0000-0000-000000000003');
insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input,attempts,attempted_at,run_id,profile)
 select id,company_id,channel_id,'a6710000-0000-0000-0000-000000000001','Busy',gen_random_uuid(),body,
  case when send_key<>'e6713000-0000-0000-0000-000000000002' then 1 else 0 end,case when send_key<>'e6713000-0000-0000-0000-000000000002' then now() end,
  case when send_key='e6713000-0000-0000-0000-000000000001' then 'busy-room-run' end,case when send_key<>'e6713000-0000-0000-0000-000000000002' then 'archive-busy' end
 from public.channel_messages where channel_id='e6712000-0000-0000-0000-000000000001';
insert into public.reply_cards(company_id,channel_message_id,channel_ordinal,run_id,call_id,kind,title,content,state)
 select company_id,id,1,'busy-room-run','q1','question','Which week?','{"question":"Which week?","choices":["This","Next"],"multiple":false}','open'
 from public.channel_messages where send_key='e6713000-0000-0000-0000-000000000001';
insert into public.channel_permissions(company_id,channel_id,message_id,run_id,ordinal,request_id,title,content,state)
 select company_id,channel_id,id,'busy-room-run',1,'p1','Post to the page','{"description":"Post to the page","command":"post","choices":["once","deny"]}','open'
 from public.channel_messages where send_key='e6713000-0000-0000-0000-000000000001';
insert into public.channel_permissions(company_id,channel_id,message_id,run_id,ordinal,request_id,title,content,state,decided_by,decided_at)
 select company_id,channel_id,id,'busy-room-run',1,'p0','Read the page','{"description":"Read the page","command":"read","choices":["once","deny"],"choice":"once"}','sending','20000000-0000-0000-0000-000000000003',now()
 from public.channel_messages where send_key='e6713000-0000-0000-0000-000000000001';
create temporary table ids on commit drop as select title,id from public.work_cards where title like 'Busy %';
grant select on ids to authenticated;
create function pg_temp.card(title text) returns bigint language sql as $$ select id from ids where ids.title=card.title $$;
create function pg_temp.cards() returns bigint[] language sql as $$ select array_agg(id order by id) from ids $$;
create function pg_temp.answer(call text) returns text language plpgsql as $$
declare result text;
begin
 execute format('select coalesce(string_agg(x::text,'',''),'''') from (%s) x(x)',call) into result;
 return result;
exception when others then return sqlstate;
end $$;
-- What would stop for the Cards, one line per thing, in a fixed order.
create function pg_temp.stops(cards bigint[]) returns text language sql as $$
 select coalesce(string_agg(format('%s %s %s',s.title,s.kind,coalesce(s.agent,'')),', ' order by s.title,s.kind),'')
 from public.card_archive_stops('10000000-0000-0000-0000-000000000001',cards) s $$;
-- What waits on the signed-in person because of these Cards.
create function pg_temp.waits() returns text language sql as $$
 select coalesce(string_agg(x.kind,',' order by x.kind),'') from public.waiting_list('10000000-0000-0000-0000-000000000001') x
 where x.card_id=any(pg_temp.cards()) or x.conversation_id='e6710000-0000-0000-0000-000000000001'
  or x.kind in ('channel_question','channel_permission','channel_hand') and x.title in ('Which week?','Post to the page') $$;
grant execute on function pg_temp.card(text),pg_temp.cards(),pg_temp.answer(text),pg_temp.stops(bigint[]),pg_temp.waits() to authenticated;

select ok(not has_function_privilege('anon','public.card_archive_stops(uuid,bigint[])','execute')
 and not has_function_privilege('service_role','public.card_archive_stops(uuid,bigint[])','execute'),'only a signed-in Member asks what archiving would stop');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.ask_review('10000000-0000-0000-0000-000000000001',pg_temp.card('Busy approval'));

-- Before: each thing that waits on someone is in their list.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.waits(),'approval,mention','the Manager waits on the approval and the note''s mention');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(pg_temp.waits(),'channel_permission,channel_question,hand,permission,question','the first Contributor waits on the chat''s question, permission and step and the room''s question and permission');

-- What would stop: one line per thing, only for the Cards where something stops.
select is(pg_temp.stops(pg_temp.cards()),
 'Busy approval approval , Busy chat hand Busy, Busy chat permission Busy, Busy chat question Busy, Busy chat run Busy, Busy note run Busy, Busy room permission Busy, Busy room question Busy, Busy room run Busy',
 'archiving names each Run, question, permission, handed step and approval that stops, with its Agent');
select is(pg_temp.stops(array[pg_temp.card('Busy idle')]),'','a Card with nothing going on stops nothing, so nothing is asked');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.stops(array[pg_temp.card('Busy room')]),'','a Member outside the team channel is told nothing of the work in it, though the Card is theirs to see');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(pg_temp.stops(pg_temp.cards()),'Busy approval approval , Busy note run ','a Member Busy is hidden from is told nothing of its Cards, nor its name');
reset role;
insert into auth.users(id,email) values ('90000000-0000-0000-0000-000000000671','outsider671@example.test');
insert into public.people(id,name) values ('90000000-0000-0000-0000-000000000671','Outsider');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000671','contributor');
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000671',true);
select is(pg_temp.stops(pg_temp.cards()),'','another Company''s Member is told nothing');

-- The Contributor archives all five.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(array_length(string_to_array(pg_temp.answer(format('select card from public.archive_cards(%L,%L::bigint[])','10000000-0000-0000-0000-000000000001',pg_temp.cards())),','),1),5,'the Contributor archives the five Cards');
select is(pg_temp.waits(),'','nothing waits on the Contributor because of them any more');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.waits(),'','nor on the Manager: the approval ended and the mention was cleared');
reset role;

-- The Runs stop through the stops that exist: the worker stops each one in the Engine (stopped_runs_open).
set local role service_role;
select is((select string_agg(run,',' order by run) from public.stopped_runs_open() where run like 'busy-%'),'busy-chat-run,busy-note-run,busy-room-run','every Run working on the Cards is stopped, the note''s among them');
reset role;
select is((select string_agg(format('%s %s',left(input,12),coalesce(outcome,'open')),', ' order by input) from public.note_runs where card_id=pg_temp.card('Busy note')),
 'Check the ca open, Draft the ho stopped, Mind the len open','a note''s Run not started yet ends stopped; the running one, and the one being started, end when the Engine says so');
select is((select string_agg(format('%s %s',left(input,12),coalesce(outcome,'open')),', ' order by input) from public.channel_runs where channel_id='e6712000-0000-0000-0000-000000000001'),
 '@Busy and th stopped, @Busy plan t open, @Busy then t open','the room''s Run not started yet ends stopped; the running one, and the one being started, end when the Engine says so');
select is((select failed_at is not null from public.conversation_queued_turns where send_key='e6711000-0000-0000-0000-000000000001'),true,'the turn waiting behind the chat''s Run never starts');
select is((select string_agg(format('%s %s',kind,state),',' order by kind) from public.reply_cards where conversation_id='e6710000-0000-0000-0000-000000000001'),
 'hand closed,permission closed,permission closed,question closed','the chat''s question, permission and handed step close unanswered, and a choice not delivered yet is never delivered');
select is((select string_agg(state,',') from public.channel_permissions where channel_id='e6712000-0000-0000-0000-000000000001'),'closed,closed','so do the room''s request and its choice not delivered yet');
select is((select count(*)::int from public.work_activity where card_id=pg_temp.card('Busy approval') and action in ('approval_rejected','approval_approved')),0,'the approval ends with no decision: it is not a rejection');
select is((select string_agg(coalesce(decision,'open'),',') from public.work_reviews where card_id=pg_temp.card('Busy approval')),'ended','and its review is ended, with no decision');
select is((select details->>'column' from public.work_activity where card_id=pg_temp.card('Busy approval') and action='card_archived'),'waiting','the archive row still names the column the Card left');

-- A Run that closes after the archive writes its end, and never asks, moves or restores the Card.
select set_config('test.note',(select note_id::text from public.note_runs where run_id='busy-note-run'),true);
select set_config('test.room',(select id::text from public.channel_messages where send_key='e6713000-0000-0000-0000-000000000001'),true);
set local role service_role;
select is(public.track_run_question('e6710000-0000-0000-0000-000000000001','busy-chat-run','{"id":"q2","text":"And the price?","choices":[],"multiple":false}'::jsonb,false,now())::text,'[]','a stopped Run''s next question is not kept');
select is(public.track_run_permission('e6710000-0000-0000-0000-000000000001','busy-chat-run','{"id":"p2","description":"Delete the old post","command":"rm","choices":["once","deny"]}'::jsonb,false,now())::text,'[]','nor its next request');
select is(public.agent_show_card('e6710000-0000-0000-0000-000000000001','busy-chat-run','h2','hand','Press Send','{"app":"WordPress","line":"Send it.","rows":[]}'::jsonb)->>'state','refused','nor a step it hands over');
select ok(public.close_conversation_run('e6710000-0000-0000-0000-000000000001','busy-chat-run','completed','Here is the June post.',null,null,null,true),'the chat''s Run closes and writes its reply');
select ok(public.close_note_run(current_setting('test.note')::bigint,'busy-note-run','completed','The caption reads well.',null,null),'the note''s Run closes and writes its reply');
select is(public.track_channel_question(current_setting('test.room')::bigint,'busy-room-run','{"id":"q2","text":"Which day?","choices":["Mon","Tue"],"multiple":false}'::jsonb,false,now())::text,'[]','the room''s stopped Run keeps no new question');
select is(public.track_channel_permission(current_setting('test.room')::bigint,'busy-room-run','{"id":"p2","description":"Delete the page","command":"rm","choices":["once","deny"]}'::jsonb,false,now())::text,'[]','nor is a choice handed to it');
reset role;
select is((select count(*)::int from public.reply_cards where conversation_id='e6710000-0000-0000-0000-000000000001' and state='open'),0,'so nothing in the chat waits on anyone');
select is((select string_agg(format('%s %s',title,(archived_at is not null)::text),',' order by title) from public.work_cards where id=any(pg_temp.cards())),
 'Busy approval true,Busy chat true,Busy idle true,Busy note true,Busy room true','every Card stays archived after its Runs closed');
select is((select status from public.work_cards where id=pg_temp.card('Busy chat')),'progress','and none moved');

-- Nothing starts work on an archived Card.
insert into public.work_comments(company_id,card_id,author_id,body) values ('10000000-0000-0000-0000-000000000001',pg_temp.card('Busy note'),'20000000-0000-0000-0000-000000000003','@Busy one more line');
select is((select count(*)::int from public.note_runs n join public.work_comments c on c.id=n.note_id where c.body='@Busy one more line'),0,'a note on an archived Card calls no Agent');
insert into public.note_runs(note_id,company_id,card_id,agent_id,agent_name,session,input)
 select n.id,n.company_id,n.card_id,'a6710000-0000-0000-0000-000000000001','Busy',gen_random_uuid(),n.body from public.work_comments n where n.body='@Busy one more line' on conflict do nothing;
select set_config('test.late',(select id::text from public.work_comments where body='@Busy one more line'),true);
set local role service_role;
select is((select count(*)::int from public.begin_note_start(current_setting('test.late')::bigint)),0,'and a note Run kept for one never starts');
reset role;
select is((select outcome from public.note_runs n join public.work_comments c on c.id=n.note_id where c.body='@Busy one more line'),'stopped','it ends stopped');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);

-- Restore starts nothing: the Cards are back, and nobody waits again.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(array_length(string_to_array(pg_temp.answer(format('select public.restore_cards(%L,%L::bigint[])','10000000-0000-0000-0000-000000000001',pg_temp.cards())),','),1),5,'the Contributor restores the five Cards');
select is(pg_temp.waits(),'','nothing waits on the Contributor again');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.waits(),'','nor on the Manager');
select is((select format('%s %s',w.status,not exists(select 1 from public.work_reviews r where r.card_id=w.id and r.decision is null)) from public.work_cards w where w.id=pg_temp.card('Busy approval')),
 'progress t','the Card whose approval ended is back in the column it was sent from, where it may be sent for approval again');
reset role;

-- A start that was on its way at the archive is stopped as the Engine names it, though the Card is back.
select set_config('test.mid',(select note_id::text from public.note_runs n join public.work_comments c on c.id=n.note_id where c.body='Mind the length'),true);
select set_config('test.year',(select id::text from public.channel_messages where send_key='e6713000-0000-0000-0000-000000000003'),true);
set local role service_role;
select ok(public.answer_note_start(current_setting('test.mid')::bigint,1,'busy-note-late'),'the note''s late start is named');
select ok(public.answer_channel_start(current_setting('test.year')::bigint,1,'busy-room-late',null),'the room''s late start is named');
select ok(public.record_conversation_turn('e6710000-0000-0000-0000-000000000001','e6711000-0000-0000-0000-000000000002','busy-chat-late','c6710000-0000-0000-0000-000000000001'),'the chat''s late turn is named');
select is((select string_agg(run,',' order by run) from public.stopped_runs_open() where run like 'busy-%-late'),'busy-chat-late,busy-note-late,busy-room-late',
 'each is stopped in the Engine, as archiving promised, after the restore');
reset role;
select is((select count(*)::int from public.note_runs where card_id=pg_temp.card('Busy note') and outcome is null and run_id is null)
 +(select count(*)::int from public.conversation_queued_turns where conversation_id='e6710000-0000-0000-0000-000000000001' and started_at is null and failed_at is null)
 +(select count(*)::int from public.channel_runs where channel_id='e6712000-0000-0000-0000-000000000001' and outcome is null and run_id is null),0,'no Run or turn is waiting to start');

select * from finish();
rollback;
