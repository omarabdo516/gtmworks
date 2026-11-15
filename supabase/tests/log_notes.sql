begin;
create extension if not exists pgtap with schema extensions;
select plan(58);
-- Notes and mentions in the log (#22). Seed people of RS Learning: Omar 0001 owns it, 0002 مدير is a Manager, 0003 مراجع
-- and 0005 عضو are Contributors, 0004 مشاهد is a Viewer, 30000000-…-0001 is a role Agent. Faye is shown to the Manager;
-- Secret to nobody but the Owner. 0005 is also a Contributor of Aleem.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state)
 select ('f2200000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','notes-'||n,'ciphertext','connected' from generate_series(1,2) n;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,instructions) values
 ('a2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000001','Faye','Marketing',false,'Write short.'),
 ('a2200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000002','Secret','Hidden',false,null);
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a2200000-0000-0000-0000-000000000001');
insert into public.work_cards(company_id,stage_id,title) select '10000000-0000-0000-0000-000000000003',id,'Aleem launch' from public.work_stages where company_id='10000000-0000-0000-0000-000000000003' order by position limit 1;
create temporary table card on commit drop as select id, title from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' order by id limit 1;
create temporary table aleem_card on commit drop as select id from public.work_cards where company_id='10000000-0000-0000-0000-000000000003' and title='Aleem launch';
create temporary table notes(label text, id bigint) on commit drop;
grant select on card, aleem_card to authenticated, service_role;
grant select, insert on notes to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into notes select x.label, public.change_work_card('10000000-0000-0000-0000-000000000001',(select id from card),'comment',jsonb_build_object('body',x.body)) from (values
 ('draft','First draft'),('fresh','Fresh note'),('call','شوف ده يا @مراجع، و @عضو و @مشاهد'),('self','@مدير remember this'),('longer','@مراجعة النهارده'),
 ('twice','@مراجع then again @مراجع'),('faye','@Faye draft the post'),('secret','@Secret look')) x(label,body);

-- The writer edits within five minutes, and the log follows.
select ok(public.edit_card_note('10000000-0000-0000-0000-000000000001',(select id from notes where label='draft'),'Second draft'),'the writer edits a note in its first five minutes');
select is((select body from public.work_comments where id=(select id from notes where label='draft')),'Second draft','the note has its new text');
select is((select string_agg(body||'|'||(details->>'edited_at' is not null)::text,',') from public.company_log where source='work_comments' and source_id=(select id from notes where label='draft')),
 'Second draft|true','its one log row follows, marked edited');
select is((select count(*)::int from public.work_activity where action='comment_added' and details->>'id'=(select id from notes where label='draft')::text),1,'an edit is not a second comment in the Card''s activity');
select ok(not public.edit_card_note('10000000-0000-0000-0000-000000000001',(select id from notes where label='draft'),'Second draft'),'saving the same text changes nothing');
select throws_ok($$select public.edit_card_note('10000000-0000-0000-0000-000000000001',(select id from notes where label='draft'),E'  \n ')$$,'22023','noteFailed','an empty note is refused');
select throws_ok($$select public.edit_card_note('10000000-0000-0000-0000-000000000003',(select id from notes where label='draft'),'Elsewhere')$$,'42501','noteNotAllowed','a note is reached only through its own Company');

-- Nobody but the writer edits it, whatever their role.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.edit_card_note('10000000-0000-0000-0000-000000000001',(select id from notes where label='draft'),'The Owner''s words')$$,'42501','noteNotYours','the Owner cannot edit another Member''s note');
delete from public.work_comments where id=(select id from notes where label='draft');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.edit_card_note('10000000-0000-0000-0000-000000000001',(select id from notes where label='draft'),'Mine now')$$,'42501','noteNotYours','nor another Member');
update public.work_comments set body='Mine now' where id=(select id from notes where label='draft');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.edit_card_note('10000000-0000-0000-0000-000000000001',(select id from notes where label='draft'),'Viewed')$$,'42501','noteNotAllowed','nor a Viewer');
reset role;
select is((select body from public.work_comments where id=(select id from notes where label='draft')),'Second draft','the Owner''s delete and another Member''s direct change touched nothing');
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select throws_ok($$update public.work_comments set body='Service words' where id=(select id from notes where label='draft')$$,'42501','noteNotYours','the service role cannot edit a note');
select throws_ok($$delete from public.work_comments where id=(select id from notes where label='draft')$$,'42501','noteIsPermanent','nor delete one');
reset role;
select throws_ok($$update public.work_comments set body='Owner of the database' where id=(select id from notes where label='draft')$$,'42501','noteNotYours','nor the database owner');
select throws_ok($$delete from public.work_comments$$,'42501','noteIsPermanent','no note is ever deleted');
select throws_ok($$update public.company_log set body='Forged' where source='work_comments' and source_id=(select id from notes where label='draft')$$,'42501','logIsPermanent','a note''s log row takes no text but its note''s');
select throws_ok($$update public.company_log set action='changed' where source='work_comments' and source_id=(select id from notes where label='draft')$$,'42501','logIsPermanent','nor any other change');

-- Five minutes on, the note is locked; four minutes on, it is still open. Comments refuse a change of time, so the test
-- moves it back with the triggers off.
set local session_replication_role=replica;
update public.work_comments set created_at=now()-interval '5 minutes' where id=(select id from notes where label='draft');
update public.work_comments set created_at=now()-interval '4 minutes' where id=(select id from notes where label='fresh');
set local session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.edit_card_note('10000000-0000-0000-0000-000000000001',(select id from notes where label='draft'),'Too late')$$,'42501','noteLocked','after five minutes the note is locked');
select ok(public.edit_card_note('10000000-0000-0000-0000-000000000001',(select id from notes where label='fresh'),'Fresh note, edited'),'at four minutes it is still open');
reset role;
select is((select body from public.work_comments where id=(select id from notes where label='draft')),'Second draft','the locked note keeps its text');
select throws_ok($$update public.work_comments set created_at=now(), body='Reopened' where id=(select id from notes where label='fresh')$$,'22023','noteFailed','even its writer changes only its text, never its time');

-- A Member named in a note: one item in their Waiting on you, which opens the note.
select is((select array_agg(person_id::text order by person_id) from public.waiting_items where note_id=(select id from notes where label='call')),
 array['20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000005'],'a note naming three Members puts one item before each, the Viewer included');
select is((select string_agg(distinct concat_ws('|',kind,title,body,asked_by,card_id::text,resolved_at::text),',') from public.waiting_items where note_id=(select id from notes where label='call')),
 concat_ws('|','mention',(select title from card),'شوف ده يا @مراجع، و @عضو و @مشاهد','مدير',(select id from card)::text),'each names the Card, the note and its writer');
select is((select count(*)::int from public.waiting_items where note_id in (select id from notes where label in ('self','longer'))),0,'naming oneself, or a longer word, puts nothing in anyone''s list');
select is((select count(*)::int from public.waiting_items where note_id=(select id from notes where label='twice')),1,'a Member named twice in one note gets one item');
select is((select count(*)::int from public.waiting_items where note_id in (select id from notes) and person_id='20000000-0000-0000-0000-000000000002'),0,'the writer gets none');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select ok(public.edit_card_note('10000000-0000-0000-0000-000000000001',(select id from notes where label='call'),'شوف ده تاني يا @مراجع، و @عضو و @مشاهد'),'the writer edits a note that named Members');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select array_agg(note_id order by note_id) from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='mention' and note_id in (select id from notes)),array[(select id from notes where label='call')],'the Viewer reads the mention in Waiting on you, with the note it opens');
select is((select body from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='mention' and note_id in (select id from notes)),'شوف ده تاني يا @مراجع، و @عضو و @مشاهد','and reads the note as it now stands');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select array_agg(note_id order by note_id) from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='mention' and note_id in (select id from notes)),(select array_agg(id order by id) from notes where label in ('call','twice')),'and each Member reads only their own');

-- An Agent called in a note: one Run, only for an Agent the writer sees.
reset role;
select is((select array_agg(n.label||':'||r.agent_name order by n.id) from public.note_runs r join notes n on n.id=r.note_id),array['faye:Faye'],'calling Faye starts one Run; calling an Agent hidden from the writer starts none');
select is((select concat_ws('|',input,instructions,session::text) from public.note_runs where note_id=(select id from notes where label='faye')),
 concat_ws('|','مدير: @Faye draft the post','Write short.',md5('note:'||(select id from card)||':a2200000-0000-0000-0000-000000000001')::uuid::text),'the Agent reads the note with its writer''s first name, its own instructions, in the Card''s session');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into notes values ('owner secret',public.change_work_card('10000000-0000-0000-0000-000000000001',(select id from card),'comment','{"body":"@Secret look"}'::jsonb));
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
insert into notes values ('agent',public.change_work_card('10000000-0000-0000-0000-000000000001',(select id from card),'comment','{"body":"@Faye and @مدير see this"}'::jsonb));
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$insert into public.work_comments(company_id,card_id,body) values ('10000000-0000-0000-0000-000000000001',(select id from card),'@Faye from the Viewer')$$,'42501',null,'a Viewer cannot write a note');
select throws_ok($$select public.change_work_card('10000000-0000-0000-0000-000000000001',(select id from card),'comment','{"body":"@Faye from the Viewer"}'::jsonb)$$,'P0001','not permitted','not through the Card either');
reset role;
select is((select agent_name from public.note_runs where note_id=(select id from notes where label='owner secret')),'Secret','the Owner, who sees every Agent, can call it');
select is((select count(*)::int from public.note_runs where note_id=(select id from notes where label='agent'))+(select count(*)::int from public.waiting_items where note_id=(select id from notes where label='agent')),0,
 'a note an Agent writes through the API calls no one');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select array_agg(agent_name order by note_id) from public.note_runs where note_id in (select id from notes)),array['Faye'],'the Manager reads the Run of the Agent they see');
select throws_ok($$select input from public.note_runs$$,'42501',null,'but not what it sent');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.note_runs where note_id in (select id from notes)),0,'a Member who does not see the Agent reads none of its Runs');

-- The Run's lifecycle, and its reply in the log under the note.
reset role;
set local role service_role;
select is((select array_agg(message) from public.note_runs_due(null,0) where message in (select id from notes)),null::bigint[],'a fresh Run belongs to its writer''s request for its first minute');
select is((select array_agg(message) from public.note_runs_due((select id from notes where label='faye'),0)),array[(select id from notes where label='faye')],'which drives it at once');
select is((select attempt from public.begin_note_start((select id from notes where label='faye'))),1,'the first attempt');
select ok(public.answer_note_start((select id from notes where label='faye'),1,'run-note-faye'),'the run id is recorded');
select ok(public.close_note_run((select id from notes where label='faye'),'run-note-faye','completed','Here is the draft.',120,30),'the Run ends with its reply');
select ok(not public.close_note_run((select id from notes where label='faye'),'run-note-faye','completed','Here is the draft.',120,30),'a second close changes nothing');
select is((select attempt from public.begin_note_start((select id from notes where label='owner secret'))),1,'another Run is asked');
select ok(public.answer_note_start((select id from notes where label='owner secret'),1,null),'refused, it ends');
reset role;
select is((select array_agg(concat_ws('|',actor_kind,actor_id::text,actor_name,agent_id::text,subject,card_id::text,action,body,details->>'reply_to')) from public.company_log where source='note_runs' and source_id in (select id from notes)),
 array[concat_ws('|','agent','a2200000-0000-0000-0000-000000000001','Faye','a2200000-0000-0000-0000-000000000001','card',(select id from card)::text,'note_reply','Here is the draft.',(select id from notes where label='faye')::text)],
 'the reply is one log row under its note, written by the Agent; a Run that failed writes none');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.company_log where action='note_reply' and source_id in (select id from notes)),1,'the writer reads the reply');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.company_log where action='note_reply' and source_id in (select id from notes)),0,'a Member who does not see the Agent does not');

-- A profile move waits for a note's open Run, as for a channel's.
reset role;
set local role service_role;
select cmp_ok(public.provide_bundled_hermes('http://hermes:8642','default','encrypted','0.23.0','{run_submission}'),'>=',1,'Aleem gets Lead on the shared profile');
select lives_ok($$select public.record_company_profile('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003',1,public.engine_tool_policy())$$,'and its own profile is made');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into notes values ('aleem',public.change_work_card('10000000-0000-0000-0000-000000000003',(select id from aleem_card),'comment','{"body":"@Lead hello"}'::jsonb));
reset role;
set local role service_role;
select is((select attempt from public.begin_note_start((select id from notes where label='aleem'))),1,'Aleem''s Lead is asked in a note');
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003','http://hermes:8642','encrypted','0.23.0','{run_submission}'),0,'its open Run holds the move');
select ok(public.close_note_run((select id from notes where label='aleem'),null,'lost',null,null,null),'once it ended');
select is(public.move_company_profile('10000000-0000-0000-0000-000000000003','http://hermes:8642','encrypted','0.23.0','{run_submission}'),1,'the Company moves');

-- The Owner's usage counts the note Runs that ran.
reset role;
create temp table used_want on commit drop as select coalesce(sum(input_tokens),0)::bigint input_tokens, count(*)::bigint runs from (
 select input_tokens from public.conversation_usage where company_id='10000000-0000-0000-0000-000000000001'
 union all select input_tokens from public.channel_runs where company_id='10000000-0000-0000-0000-000000000001' and outcome is not null and run_id is not null
 union all select input_tokens from public.note_runs where company_id='10000000-0000-0000-0000-000000000001' and outcome is not null and run_id is not null) u;
grant select on used_want to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select array[sum(input_tokens),sum(runs)]::bigint[] from public.usage_by_day() where company_id='10000000-0000-0000-0000-000000000001'),
 (select array[input_tokens,runs] from used_want),'the Owner''s usage counts the note Runs that ran and their tokens');
select ok((select input_tokens from used_want)>=120,'which here holds Faye''s 120 tokens');
select * from finish();
rollback;
