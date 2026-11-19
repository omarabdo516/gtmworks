begin;
create extension if not exists pgtap with schema extensions;
select plan(30);
-- #155: an image a person attaches to a message in their Conversation is kept under the send key, linked to the message
-- it was sent with, and only its sender writes it. A message may carry images alone, so its text may be empty.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000001','Lead','General',true,'default'),
 ('a2200000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','f2200000-0000-0000-0000-000000000003','Lead','General',true,'default');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a2200000-0000-0000-0000-000000000001','Lead'),
 ('c2200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a2200000-0000-0000-0000-000000000001','Lead'),
 ('c2200000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000005','a2200000-0000-0000-0000-000000000003','Lead');
-- A message of images alone is stored: its text is empty, and the record keeps it.
select lives_ok($$insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values('10000000-0000-0000-0000-000000000001','c2200000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','','d2200000-0000-0000-0000-000000000001','run_files')$$,'a message may be stored with no text');
-- A turn that waits carries one too, so an image-only message queues behind a Run while the Agent is busy.
select lives_ok($$insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message)
 values('c2200000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a2200000-0000-0000-0000-000000000001','')$$,'a waiting turn may carry no text either');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

-- The Owner keeps two images with a message they already sent; the rows are linked to it by its send key.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_files('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000001',
 $json$[{"position":0,"name":"cover.png","content_type":"image/png","size":90,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d2200000-0000-0000-0000-000000000001-0"},
        {"position":1,"name":"logo.jpeg","content_type":"image/jpeg","size":20,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d2200000-0000-0000-0000-000000000001-1"}]$json$::jsonb),
 2,'an Owner keeps two images with their message');
select is((select count(*)::int from public.conversation_attachments a join public.conversation_messages m on m.id=a.message_id
 where m.send_key='d2200000-0000-0000-0000-000000000001'),2,'and both are linked to the message they were sent with');
-- Kept before the message exists (a turn that waits), a file is linked when the message is stored.
select is(public.reserve_conversation_files('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000002',
 $json$[{"position":0,"name":"chart.webp","content_type":"image/webp","size":40,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d2200000-0000-0000-0000-000000000002-0"}]$json$::jsonb),
 1,'a file is kept for a turn still waiting');
select is((select message_id from public.conversation_attachments where send_key='d2200000-0000-0000-0000-000000000002'),null::bigint,'with no message to belong to yet');
select is(public.send_conversation_message('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a2200000-0000-0000-0000-000000000001','','d2200000-0000-0000-0000-000000000002','run_waited'),true,'the waiting turn is stored with no text as its sender''s message');
select is((select message_id is not null from public.conversation_attachments where send_key='d2200000-0000-0000-0000-000000000002'),true,'and its file is linked to it then');

-- A send the engine refused takes its files with it, and only files no message took.
select is(public.reserve_conversation_files('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000003',
 $json$[{"position":0,"name":"refused.png","content_type":"image/png","size":90,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d2200000-0000-0000-0000-000000000003-0"}]$json$::jsonb),
 1,'a sender keeps an image for a send that is starting');
select is((select public.discard_conversation_files('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000003')),
 '10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d2200000-0000-0000-0000-000000000003-0'::text,'a refused send gives its own file path back');
select is((select count(*)::int from public.conversation_attachments where send_key='d2200000-0000-0000-0000-000000000003'),0,'and keeps no row for it');
select is((select count(*)::int from public.discard_conversation_files('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000001')),0,'a message''s own files are not a refused send''s to remove');

-- Rules on what may be kept: one to five, the image kinds the Engine reads, a path the database builds itself, never by
-- hand, and never over a stored message's own files.
select throws_ok($$select public.reserve_conversation_files('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000004',
 $json$[{"position":0,"name":"a.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d-0"},
        {"position":1,"name":"b.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d-1"},
        {"position":2,"name":"c.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d-2"},
        {"position":3,"name":"d.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d-3"},
        {"position":4,"name":"e.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d-4"},
        {"position":5,"name":"f.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d-5"}]$json$::jsonb)$$,
 '22023','conversationFilesInvalid','six files are more than a message carries');
select is(public.reserve_conversation_files('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000004',
 $json$[{"position":0,"name":"stray.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000002/stray.png"}]$json$::jsonb),
 1,'a caller''s own path is ignored');
select is((select path from public.conversation_attachments where send_key='d2200000-0000-0000-0000-000000000004'),
 '10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d2200000-0000-0000-0000-000000000004-0'::text,
 'and the database names it inside its own Conversation');
select throws_ok($$select public.reserve_conversation_files('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000004',
 $json$[{"position":1,"name":"page.html","content_type":"text/html","size":1,"path":"anywhere"}]$json$::jsonb)$$,
 '22023','conversationFilesInvalid','only the image kinds the Engine reads are kept');
select is(public.reserve_conversation_files('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000001',
 $json$[{"position":0,"name":"again.png","content_type":"image/png","size":1,"path":"anywhere"}]$json$::jsonb),
 -1,'a retry by the same sender of a stored send is already stored');
select is((select count(*)::int from public.conversation_attachments where send_key='d2200000-0000-0000-0000-000000000001'),2,
 'and its two files are still the ones it stored');
select throws_ok($$insert into public.conversation_attachments(company_id,conversation_id,name,content_type,size,path)
 values('10000000-0000-0000-0000-000000000001','c2200000-0000-0000-0000-000000000001','hand.png','image/png',1,'10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/hand.png')$$,
 '42501',null,'nobody adds a file by hand');
select throws_ok($$select public.reserve_conversation_files('c2200000-0000-0000-0000-0000000000ff','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000004',
 $json$[{"position":0,"name":"loose.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-0000000000ff/loose.png"}]$json$::jsonb)$$,
 'P0002','conversationNotFound','a file belongs to a Conversation already there');

-- Who may keep them: anyone who may write in their own Conversation, and no one else's.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.reserve_conversation_files('c2200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000005',
 $json$[{"position":0,"name":"mine.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000002/d2200000-0000-0000-0000-000000000005-0"}]$json$::jsonb),
 1,'a Contributor keeps an image in their own Conversation');
select throws_ok($$select public.reserve_conversation_files('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000006',
 $json$[{"position":0,"name":"theirs.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d2200000-0000-0000-0000-000000000006-0"}]$json$::jsonb)$$,
 'P0002','conversationNotFound','a Contributor cannot attach to another Member''s Conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.reserve_conversation_files('c2200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000007',
 $json$[{"position":0,"name":"manager.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000002/d2200000-0000-0000-0000-000000000007-0"}]$json$::jsonb)$$,
 'P0002','conversationNotFound','a Manager cannot attach to a Contributor''s Conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.reserve_conversation_files('c2200000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000008',
 $json$[{"position":0,"name":"viewer.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000002/d2200000-0000-0000-0000-000000000008-0"}]$json$::jsonb)$$,
 '42501','conversationNotAllowed','a Viewer attaches nothing');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.reserve_conversation_files('c2200000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','d2200000-0000-0000-0000-000000000009',
 $json$[{"position":0,"name":"other.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000003/conversations/c2200000-0000-0000-0000-000000000003/d2200000-0000-0000-0000-000000000009-0"}]$json$::jsonb)$$,
 'P0002','conversationNotFound','an Owner attaches nothing to another person''s Conversation in another Company they are in');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.reserve_conversation_files('c2200000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000010',
 $json$[{"position":0,"name":"someone.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/conversations/c2200000-0000-0000-0000-000000000001/d2200000-0000-0000-0000-000000000010-0"}]$json$::jsonb)$$,
 'P0002','conversationNotFound','a Member of two Companies attaches nothing to another person''s Conversation in either');
-- The files are as private as their Conversation: another Member reads none of them.
select is((select count(*)::int from public.conversation_attachments),0,'a Member of two Companies reads no file of another person''s Conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select jsonb_agg(name order by name) from public.conversation_attachments),jsonb_build_array('mine.png'),'a Contributor reads the file of their own Conversation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.conversation_attachments),0,'a Manager reads no one else''s files');
-- An Owner's first message of images alone, to an Agent that is free, reserves its Run like any other message.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_turn('c2200000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','a2200000-0000-0000-0000-000000000001','d2200000-0000-0000-0000-000000000011','')->>'state',
 'reserved','a message of images alone reserves its Run');
select * from finish();
rollback;
