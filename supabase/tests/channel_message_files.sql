begin;
create extension if not exists pgtap with schema extensions;
select plan(33);
-- #156: a channel message keeps its images, every Member of the channel reads them (a Viewer included), and only a
-- Member of the channel who may write keeps them. A message of images alone is stored and starts no Run; a text of
-- spaces only is still refused, as before.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,instructions,profile) values
 ('a2400000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f2400000-0000-0000-0000-000000000001','Faye','Marketing',true,null,'default');
-- A team channel of the same Company with the Owner and the Viewer only: the Manager is outside it.
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('69000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','team','files','20000000-0000-0000-0000-000000000001',gen_random_uuid());
insert into public.channel_people(channel_id,company_id,person_id,added_by) values
 ('69000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('69000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001');
-- A Member of another Company, to prove its Owner reads nothing here.
insert into auth.users(id,email) values ('b2400000-0000-0000-0000-000000000001','elsewhere-files@example.test');
insert into public.people(id,name) values ('b2400000-0000-0000-0000-000000000001','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','b2400000-0000-0000-0000-000000000001','owner');
-- The messages this file writes, by name: a sender's key is theirs, so the tests never read it back.
create temporary table sent(label text primary key, id bigint) on commit drop;
grant select, insert on sent to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

-- The Owner keeps both images under the send key before the message is stored, then writes a message of images alone in
-- the general channel: storing it links them.
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000001',
 $json$[{"position":0,"name":"cover.png","content_type":"image/png","size":90,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000001-0"},
        {"position":1,"name":"logo.jpeg","content_type":"image/jpeg","size":20,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000001-1"}]$json$::jsonb),
 2,'its writer keeps two images under its send key');
select lives_ok($$insert into sent select 'images', public.post_channel_message('69000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000001','')$$,
 'a channel message may carry images alone');
select is((select count(*)::int from public.channel_attachments where message_id=(select id from sent where label='images')),2,
 'and both belong to the message it was sent with');
select is((select body from public.channel_messages where id=(select id from sent where label='images')),'','the message is stored with no text');
select is((select count(*)::int from public.channel_runs where message_id=(select id from sent where label='images')),0,
 'a message of images that calls no Agent starts no Run');
select throws_ok($$select public.post_channel_message('69000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000002','')$$,
 '22023','channelFailed','a message of no text at all needs files to carry');
select throws_ok($$select public.post_channel_message('69000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000002','   ')$$,
 '22023','channelFailed','a text of spaces only is still refused');

-- Rules on what may be kept: one to five, the image kinds the Engine reads, a path the database builds itself, never by
-- hand, and never over a stored message's own files.
select throws_ok($$select public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000001',
 $json$[{"position":0,"name":"a.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-0"},
        {"position":1,"name":"b.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-1"},
        {"position":2,"name":"c.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-2"},
        {"position":3,"name":"d.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-3"},
        {"position":4,"name":"e.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-4"},
        {"position":5,"name":"f.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-5"}]$json$::jsonb)$$,
 '22023','channelFilesInvalid','six files are more than a message carries');
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000007',
 $json$[{"position":9,"name":"stray.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000002/d2400000-0000-0000-0000-000000000007-9"}]$json$::jsonb),
 1,'a caller''s own path is ignored');
select is((select path from public.channel_attachments where name='stray.png'),
 '10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000007-9'::text,
 'and the database names it inside its own channel');
-- The placeholder row above is a send that posted nothing: give it back before the counts below read the channel.
select public.discard_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000007');
select throws_ok($$select public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000007',
 $json$[{"position":1,"name":"page.html","content_type":"text/html","size":1,"path":"anywhere"}]$json$::jsonb)$$,
 '22023','channelFilesInvalid','only the image kinds the Engine reads are kept');
select throws_ok($$select public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000001',
 $json$[{"position":2,"name":"again.png","content_type":"image/png","size":1,"path":"anywhere"}]$json$::jsonb)$$,
 'P0002','channelNotFound','a stored message''s images can never be replaced');
select throws_ok($$insert into public.channel_attachments(company_id,channel_id,send_key,message_id,name,content_type,size,path)
 values ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000003',(select id from sent where label='images'),'hand.png','image/png',1,
  '10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/hand.png')$$,
 '42501',null,'nobody adds a file by hand');

-- A Viewer of the channel reads every file and attaches none.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.channel_attachments where channel_id='69000000-0000-0000-0000-000000000001'),2,
 'a Viewer of the channel reads its files');
select is((select array_agg(name order by position) from public.channel_attachments where channel_id='69000000-0000-0000-0000-000000000001'),
 array['cover.png','logo.jpeg'],'in the order they were chosen');
select throws_ok($$select public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000003',
 $json$[{"position":0,"name":"viewer.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000003-0"}]$json$::jsonb)$$,
 '42501','channelNotAllowed','a Viewer attaches nothing');

-- A Contributor keeps images with their own message, and a failed send gives its own back.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000003',
 $json$[{"position":0,"name":"mine.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000003-0"}]$json$::jsonb),
 1,'a Contributor keeps an image before posting their message');
select lives_ok($$insert into sent select 'contributor', public.post_channel_message('69000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000003','Two pictures')$$,
 'a Contributor writes in the general channel');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000003',
 $json$[{"position":1,"name":"theirs.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000003-1"}]$json$::jsonb)$$,
 'P0002','channelNotFound','another Member cannot replace a stored message''s image');
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000004',
 $json$[{"position":0,"name":"refused.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000004-0"}]$json$::jsonb),
 1,'a sender keeps an image before its message is posted');
select is((select public.discard_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000004')),
 '10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000004-0'::text,
 'a failed send gives its own file path back');
select is((select count(*)::int from public.channel_attachments where name='refused.png'),0,
 'and leaves no row for it');

-- A waiting key belongs to one sender, and a retry of a stored send is that same send.
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000012',
 $json$[{"position":0,"name":"waiting.png","content_type":"image/png","size":1,"path":"anywhere"}]$json$::jsonb),
 1,'a sender keeps an image under a fresh key');
select lives_ok($$insert into sent select 'retried', public.post_channel_message('69000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000012','Owner retry')$$,
 'the Owner stores the message under that key');
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000012',
 $json$[{"position":0,"name":"waiting.png","content_type":"image/png","size":1,"path":"anywhere"}]$json$::jsonb),
 -1,'a retry by the same sender of a stored send is already stored');

-- A team channel's files are its own Members' only.
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000005',
 $json$[{"position":0,"name":"team.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000002/d2400000-0000-0000-0000-000000000005-0"}]$json$::jsonb),
 1,'the Owner keeps an image in it');
select lives_ok($$insert into sent select 'team', public.post_channel_message('69000000-0000-0000-0000-000000000002','d2400000-0000-0000-0000-000000000005','Only us')$$,
 'and writes in it');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.channel_attachments where channel_id='69000000-0000-0000-0000-000000000002'),0,
 'a Member outside the channel reads none of its files');
select throws_ok($$select public.reserve_channel_files('69000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000005',
 $json$[{"position":1,"name":"outside.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000002/d2400000-0000-0000-0000-000000000005-1"}]$json$::jsonb)$$,
 'P0002','channelNotFound','nor attaches one');

-- Another Company's Owner, and a visitor, read nothing.
select set_config('request.jwt.claim.sub','b2400000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.channel_attachments),0,'a Member of another Company reads no channel file');
select throws_ok($$select public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000001',
 $json$[{"position":9,"name":"elsewhere.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000001-9"}]$json$::jsonb)$$,
 'P0002','channelNotFound','nor attaches one in it');
set local role anon;
select throws_ok($$select count(*) from public.channel_attachments$$,'42501',null,'a visitor reads none');
reset role;

-- The stored bytes are as open as their row: a Member of the channel reads the image the server wrote for it.
insert into storage.objects(bucket_id,name) values
 ('creatives','10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000001-0');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from storage.objects where name='10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000001-0'),
 1,'a Member of the channel reads its stored image');
reset role;

select * from finish();
rollback;
