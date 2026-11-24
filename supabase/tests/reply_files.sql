begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
-- #708, ADR 0028: an Agent's reply hands its person files. The close stores the reply with them: rows of the place's
-- files table on the Agent's message, at paths the database builds itself, and the names of the files it could not hand
-- over. A reply of files alone is a whole reply; a close that stores no message stores no file.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a7080000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f7080000-0000-0000-0000-000000000001','Trainer','Training',false,'default'),
 ('a7080000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f7080000-0000-0000-0000-000000000002','Deckmaker','Decks',false,'default');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c7080000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a7080000-0000-0000-0000-000000000001','Trainer');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c7080000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','ابعتهولي هنا كفايل احمله','d7080000-0000-0000-0000-000000000001','run_708_files'),
 ('10000000-0000-0000-0000-000000000001','c7080000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','والصور؟','d7080000-0000-0000-0000-000000000002','run_708_alone'),
 ('10000000-0000-0000-0000-000000000001','c7080000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','وقف','d7080000-0000-0000-0000-000000000003','run_708_stopped');
create temporary table sent(label text, id bigint) on commit drop;
grant select, insert on sent to authenticated, service_role;

set local role service_role;
select is(public.close_conversation_run('c7080000-0000-0000-0000-000000000001','run_708_files','completed','Here is the report.',null,null,null,true,
 $json$[{"position":0,"name":"market-vs-platform-report.pdf","content_type":"application/pdf","size":180000,"path":"anything/the/caller/says"},
        {"position":1,"name":"page-01.jpg","content_type":"image/jpeg","size":24000000}]$json$::jsonb,array['secret.pdf']),true,'a reply with two files and one that could not be attached closes its Run');
reset role;
select is((select array_agg(a.name||':'||a.content_type||':'||a.size order by a.position) from public.conversation_attachments a join public.conversation_messages m on m.id=a.message_id
 where m.run_id='run_708_files' and m.author='agent'),array['market-vs-platform-report.pdf:application/pdf:180000','page-01.jpg:image/jpeg:24000000'],
 'the Agent''s message takes both files, in order, one past a person''s 20 MB too');
select is((select array_agg(a.path order by a.position) from public.conversation_attachments a join public.conversation_messages m on m.id=a.message_id where m.run_id='run_708_files' and m.author='agent'),
 array['10000000-0000-0000-0000-000000000001/conversations/c7080000-0000-0000-0000-000000000001/reply-'||md5('run_708_files')||'-0',
       '10000000-0000-0000-0000-000000000001/conversations/c7080000-0000-0000-0000-000000000001/reply-'||md5('run_708_files')||'-1'],
 'at the paths the database builds, never the caller''s');
select is((select body||'|'||array_to_string(missed_files,',') from public.conversation_messages where run_id='run_708_files' and author='agent'),'Here is the report.|secret.pdf',
 'the reply keeps its text and the name of the file it could not hand over');
select is((select count(*)::int from public.conversation_attachments where conversation_id='c7080000-0000-0000-0000-000000000001' and send_key is null and message_id is not null),2,
 'a reply''s files have no send key a person''s send could claim');

set local role service_role;
select is(public.close_conversation_run('c7080000-0000-0000-0000-000000000001','run_708_files','completed','Again.',null,null,null,true,
 $json$[{"position":0,"name":"other.pdf","content_type":"application/pdf","size":10}]$json$::jsonb,null),false,'a second close of the same Run stores nothing');
select is(public.close_conversation_run('c7080000-0000-0000-0000-000000000001','run_708_alone','completed','',null,null,null,true,
 $json$[{"position":0,"name":"page-02.png","content_type":"image/png","size":10}]$json$::jsonb,null),true,'a reply of a file alone is a whole reply');
select throws_ok($$select public.close_conversation_run('c7080000-0000-0000-0000-000000000001','run_708_stopped','completed','',null,null,null,true,'[]'::jsonb,null)$$,
 '22023','conversationFailed','a reply with no text and no file is still no reply');
select throws_ok($$select public.close_conversation_run('c7080000-0000-0000-0000-000000000001','run_708_stopped','stopped',null,null,null,null,true,
 '[{"position":0,"name":"x.pdf","content_type":"application/pdf","size":10}]'::jsonb,null)$$,'22023','conversationFailed','only a completed reply hands files over');
select throws_ok($$select public.close_conversation_run('c7080000-0000-0000-0000-000000000001','run_708_stopped','completed','x',null,null,null,true,
 '[{"position":0,"name":"x.pdf","content_type":"application/pdf","size":26214401}]'::jsonb,null)$$,'23514',null,'a file past 25 MB is never kept');
select throws_ok($$select public.close_conversation_run('c7080000-0000-0000-0000-000000000001','run_708_stopped','completed','x',null,null,null,true,
 (select jsonb_agg(jsonb_build_object('position',0,'name','x.pdf','content_type','application/pdf','size',1)) from generate_series(1,11)),null)$$,'22023','conversationFailed','eleven files are more than a reply hands over');
select is(public.close_conversation_run('c7080000-0000-0000-0000-000000000001','run_708_stopped','stopped',null,null,null,null,true),true,'the previous version''s close is kept as it was');
reset role;
select is((select body||'|'||(select count(*) from public.conversation_attachments a where a.message_id=m.id) from public.conversation_messages m where run_id='run_708_alone' and author='agent'),'|1',
 'the reply of a file alone is stored with no text and its file');

-- Its person reads the reply's files; another Member of the Company does not.
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.conversation_attachments where conversation_id='c7080000-0000-0000-0000-000000000001'),3,'the Conversation''s person reads the files of its replies');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.conversation_attachments where conversation_id='c7080000-0000-0000-0000-000000000001'),0,'another Member reads none');
select throws_ok($$select public.close_conversation_run('c7080000-0000-0000-0000-000000000001','run_708_stopped','completed','x',null,null,null,true,'[]'::jsonb,null)$$,
 '42501',null,'and no signed-in person closes a Run');

-- A channel's reply keeps its files the same way, for every Member of the channel.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into sent values ('ask',public.post_channel_message('69000000-0000-0000-0000-000000000001',gen_random_uuid(),'@Deckmaker send the deck'));
set local role service_role;
select is((select attempt from public.begin_channel_start((select id from sent where label='ask'))),1,'the channel''s Run is started');
select ok(public.answer_channel_start((select id from sent where label='ask'),1,'run_708_channel'),'with its engine run id');
select is(public.close_channel_run((select id from sent where label='ask'),'run_708_channel','completed','',null,null,
 $json$[{"position":0,"name":"deck.pdf","content_type":"application/pdf","size":900}]$json$::jsonb,array['gone.png']),true,'a channel reply of a file alone closes its Run');
reset role;
select is((select array_agg(a.name||':'||a.path||':'||array_to_string(m.missed_files,',')) from public.channel_attachments a join public.channel_messages m on m.id=a.message_id where m.reply_to=(select id from sent where label='ask')),
 array['deck.pdf:10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/reply-'||md5('run_708_channel')||'-0:gone.png'],
 'its message takes the file at the path the database builds, and the name it could not hand over');
select * from finish();
rollback;
