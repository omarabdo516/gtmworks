begin;
create extension if not exists pgtap with schema extensions;
select plan(26);
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

-- The Owner writes a message of images alone in the general channel and keeps both images with it.
select lives_ok($$insert into sent select 'images', public.post_channel_message('69000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000001','')$$,
 'a channel message may carry images alone');
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000001',
 $json$[{"position":0,"name":"cover.png","content_type":"image/png","size":90,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000001-0"},
        {"position":1,"name":"logo.jpeg","content_type":"image/jpeg","size":20,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000001-1"}]$json$::jsonb),
 2,'its writer keeps two images with it');
select is((select count(*)::int from public.channel_attachments where message_id=(select id from sent where label='images')),2,
 'and both belong to the message it was sent with');
select is((select body from public.channel_messages where id=(select id from sent where label='images')),'','the message is stored with no text');
select is((select count(*)::int from public.channel_runs where message_id=(select id from sent where label='images')),0,
 'a message of images that calls no Agent starts no Run');
select throws_ok($$select public.post_channel_message('69000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000002','   ')$$,
 '22023','channelFailed','a text of spaces only is still refused');

-- Rules on what may be kept: one to five, a path inside the channel, and never by hand.
select throws_ok($$select public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000001',
 $json$[{"position":0,"name":"a.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-0"},
        {"position":1,"name":"b.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-1"},
        {"position":2,"name":"c.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-2"},
        {"position":3,"name":"d.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-3"},
        {"position":4,"name":"e.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-4"},
        {"position":5,"name":"f.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d-5"}]$json$::jsonb)$$,
 '22023','channelFilesInvalid','six files are more than a message carries');
select throws_ok($$select public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000001',
 $json$[{"position":9,"name":"stray.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000002/d2400000-0000-0000-0000-000000000001-9"}]$json$::jsonb)$$,
 '23514',null,'a file stays in the channel its message is in');
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
select lives_ok($$insert into sent select 'contributor', public.post_channel_message('69000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000003','Two pictures')$$,
 'a Contributor writes in the general channel');
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000003',
 $json$[{"position":0,"name":"mine.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000003-0"}]$json$::jsonb),
 1,'a Contributor keeps an image with their own message');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000003',
 $json$[{"position":1,"name":"theirs.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000003-1"}]$json$::jsonb)$$,
 'P0002','channelNotFound','an Owner attaches nothing to another Member''s message');
select lives_ok($$insert into sent select 'refused', public.post_channel_message('69000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000004','Refused')$$,
 'a message is stored before its bytes');
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000004',
 $json$[{"position":0,"name":"refused.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000004-0"}]$json$::jsonb),
 1,'and keeps an image for a send being written');
select is((select public.discard_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000004')),
 '10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000001/d2400000-0000-0000-0000-000000000004-0'::text,
 'a send whose bytes failed gives its own file path back');
select is((select count(*)::int from public.channel_attachments where message_id=(select id from sent where label='refused')),0,
 'and keeps no row for it');

-- A team channel's files are its own Members' only.
select lives_ok($$insert into sent select 'team', public.post_channel_message('69000000-0000-0000-0000-000000000002','d2400000-0000-0000-0000-000000000005','Only us')$$,
 'the Owner writes in a team channel');
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','d2400000-0000-0000-0000-000000000005',
 $json$[{"position":0,"name":"team.png","content_type":"image/png","size":1,"path":"10000000-0000-0000-0000-000000000001/channels/69000000-0000-0000-0000-000000000002/d2400000-0000-0000-0000-000000000005-0"}]$json$::jsonb),
 1,'and keeps an image in it');
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

select * from finish();
rollback;
