begin;
create extension if not exists pgtap with schema extensions;
select plan(29);
-- All conversations (#673): a person's own Conversations and the channels they are in, newest message first, with a
-- title search that reads Arabic as the product's search does, a page at a time. RS Learning's seeded Owner (…01), its
-- Manager (…02) and a Contributor (…03); Faye is shown to nobody but the Owner.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6730000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f6730000-0000-0000-0000-000000000001','Lead','General',true,'default'),
 ('a6730000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f6730000-0000-0000-0000-000000000002','Faye','Marketing',false,'default');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,created_at) values
 ('c6730000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a6730000-0000-0000-0000-000000000001','Lead','2026-11-01 09:00Z'),
 ('c6730000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a6730000-0000-0000-0000-000000000001','Lead','2026-11-02 09:00Z'),
 ('c6730000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a6730000-0000-0000-0000-000000000001','Lead','2026-11-03 09:00Z'),
 ('c6730000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a6730000-0000-0000-0000-000000000001','Lead','2026-11-04 09:00Z'),
 ('c6730000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a6730000-0000-0000-0000-000000000002','Faye','2026-11-05 09:00Z');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,run_id,created_at,send_key) values
 ('10000000-0000-0000-0000-000000000001','c6730000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000002','مدير',E'مُــهمّة إعلانات ديسمبر\nوالتفاصيل','r1','2026-11-01 09:00Z',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','c6730000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000002','مدير','Weekly REPORT','r2','2026-11-02 09:00Z',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','c6730000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000002','مدير','أسعار الكورس','r3','2026-11-03 09:00Z',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','c6730000-0000-0000-0000-000000000004','person','20000000-0000-0000-0000-000000000003','مراجع','Not the Manager''s','r4','2026-11-04 09:00Z',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','c6730000-0000-0000-0000-000000000005','person','20000000-0000-0000-0000-000000000002','مدير','Hidden from the Manager','r5','2026-11-05 09:00Z',gen_random_uuid()),
 -- The oldest Conversation gets the newest message: it comes first.
 ('10000000-0000-0000-0000-000000000001','c6730000-0000-0000-0000-000000000001','agent',null,'Lead','Here is the plan','r1','2026-11-10 09:00Z',null);
-- The general channel, a team channel the Manager is in and one they are not, each with a message.
insert into public.channels(id,company_id,kind,name,created_at,created_by,create_key) values
 ('c6730000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001','team','Launch week','2026-10-01Z','20000000-0000-0000-0000-000000000001',gen_random_uuid()),
 ('c6730000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-000000000001','team','Secret plans','2026-10-01Z','20000000-0000-0000-0000-000000000001',gen_random_uuid());
insert into public.channel_people(channel_id,company_id,person_id) values
 ('c6730000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'),
 ('c6730000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003');
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,created_at,send_key) values
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','Morning all','2026-11-06 09:00Z',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','c6730000-0000-0000-0000-0000000000a1','person','20000000-0000-0000-0000-000000000002','مدير','Launch on Sunday','2026-11-08 09:00Z',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','c6730000-0000-0000-0000-0000000000a2','person','20000000-0000-0000-0000-000000000003','مراجع','Shh','2026-11-09 09:00Z',gen_random_uuid());

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);

select is((select array_agg(kind||':'||id::text order by ordinality) from public.conversation_list('10000000-0000-0000-0000-000000000001') with ordinality),
 array['conversation:c6730000-0000-0000-0000-000000000001','channel:c6730000-0000-0000-0000-0000000000a1','channel:69000000-0000-0000-0000-000000000001',
  'conversation:c6730000-0000-0000-0000-000000000003','conversation:c6730000-0000-0000-0000-000000000002'],
 'the Manager''s own Conversations and the channels they are in, newest message first; no one else''s, no hidden Agent''s, no channel they are not in');
select is((select title||' · '||last_body from public.conversation_list('10000000-0000-0000-0000-000000000001') where id='c6730000-0000-0000-0000-000000000001'),
 'مُــهمّة إعلانات ديسمبر · Here is the plan','a Conversation is titled by the first line of its first message, with its newest message under it');
select is((select last_at from public.conversation_list('10000000-0000-0000-0000-000000000001') where id='c6730000-0000-0000-0000-000000000001'),
 '2026-11-10 09:00Z'::timestamptz,'and dated by it');
select is((select channel_kind||':'||coalesce(title,'-') from public.conversation_list('10000000-0000-0000-0000-000000000001') where kind='channel' order by last_at limit 1),
 'general:-','the general channel carries no name of its own');
select is((select agent_name||':'||connection_id from public.conversation_list('10000000-0000-0000-0000-000000000001') where id='c6730000-0000-0000-0000-000000000003'),
 'Lead:f6730000-0000-0000-0000-000000000001','a Conversation carries its Agent''s name and face');

-- A page at a time: the next page starts after the last row of the one before, in the same order.
select is((select array_agg(id::text order by ordinality) from public.conversation_list('10000000-0000-0000-0000-000000000001',lim=>2) with ordinality),
 array['c6730000-0000-0000-0000-000000000001','c6730000-0000-0000-0000-0000000000a1'],'a page holds as many as asked');
select is((select array_agg(id::text order by ordinality) from public.conversation_list('10000000-0000-0000-0000-000000000001',
  after_at=>'2026-11-08 09:00Z',after_id=>'c6730000-0000-0000-0000-0000000000a1',lim=>2) with ordinality),
 array['69000000-0000-0000-0000-000000000001','c6730000-0000-0000-0000-000000000003'],'the next page goes on after it');
select is((select count(*)::int from public.conversation_list('10000000-0000-0000-0000-000000000001',
  after_at=>'2026-11-02 09:00Z',after_id=>'c6730000-0000-0000-0000-000000000002')),0,'and the last page is the end');
select is((select count(*)::int from public.conversation_list('10000000-0000-0000-0000-000000000001',lim=>500)),5,'a page asked too long is held to its most');

-- The search reads every title, case aside, Arabic without its marks or tatweel and every hamza seat as its letter.
select is((select array_agg(id::text) from public.conversation_list('10000000-0000-0000-0000-000000000001',q=>'  مهمه  ')),
 array['c6730000-0000-0000-0000-000000000001'],'a search finds a title without its marks, tatweel or teh marbuta');
select is((select array_agg(id::text) from public.conversation_list('10000000-0000-0000-0000-000000000001',q=>'اسعار')),
 array['c6730000-0000-0000-0000-000000000003'],'and with its hamza seat read as its letter');
select is((select array_agg(id::text) from public.conversation_list('10000000-0000-0000-0000-000000000001',q=>'weekly report')),
 array['c6730000-0000-0000-0000-000000000002'],'and in any case');
select is((select array_agg(id::text) from public.conversation_list('10000000-0000-0000-0000-000000000001',q=>'LAUNCH')),
 array['c6730000-0000-0000-0000-0000000000a1'],'a channel is found by its name');
select is((select array_agg(id::text) from public.conversation_list('10000000-0000-0000-0000-000000000001',q=>'عام',general=>'عام')),
 array['69000000-0000-0000-0000-000000000001'],'the general channel by the name the reader reads');
select is((select count(*)::int from public.conversation_list('10000000-0000-0000-0000-000000000001',q=>'Here is the plan')),0,'a search reads the titles, not the messages');
select is((select count(*)::int from public.conversation_list('10000000-0000-0000-0000-000000000001',q=>'Not the Manager')),0,'nor finds another person''s');
select is((select count(*)::int from public.conversation_list('10000000-0000-0000-0000-000000000001',q=>'Shh')),0,'nor a channel the reader is not in');
select is(public.conversation_counts('10000000-0000-0000-0000-000000000001'),'{"current":5,"archived":0}'::jsonb,'the counts of each list');
-- An archived Conversation (#674) leaves the current list for the archived one, and is counted there.
select is((select count(*)::int from public.archive_conversations('10000000-0000-0000-0000-000000000001',array['c6730000-0000-0000-0000-000000000002'::uuid])),1,'the Manager archives one');
select is((select array_agg(id::text) from public.conversation_list('10000000-0000-0000-0000-000000000001',archived=>true)),
 array['c6730000-0000-0000-0000-000000000002'],'the archived list holds it');
select is((select count(*)::int from public.conversation_list('10000000-0000-0000-0000-000000000001') where id='c6730000-0000-0000-0000-000000000002'),0,'the current list leaves it out');
select is(public.conversation_counts('10000000-0000-0000-0000-000000000001'),'{"current":4,"archived":1}'::jsonb,'and each list counts its own');
select is((select count(*)::int from public.conversation_list('10000000-0000-0000-0000-000000000001',q=>'weekly',archived=>true)),1,'the archived list is searched as the current one is');
select is((select count(*)::int from public.restore_conversations('10000000-0000-0000-0000-000000000001',array['c6730000-0000-0000-0000-000000000002'::uuid])),1,'and restores it');

-- A morning's Conversation is searched by its name in the reader's language.
reset role;
update public.conversations set good_morning_day='2026-11-03' where id='c6730000-0000-0000-0000-000000000003';
set local role authenticated;
select is((select array_agg(id::text) from public.conversation_list('10000000-0000-0000-0000-000000000001',q=>'صباح',morning=>'صباح الخير')),
 array['c6730000-0000-0000-0000-000000000003'],'a morning''s Conversation is found by the morning''s name');

-- The sidebar's own read orders by the newest message too.
select is((select array_agg(id::text order by last_message_at desc, id desc) from public.conversations where company_id='10000000-0000-0000-0000-000000000001'),
 array['c6730000-0000-0000-0000-000000000001','c6730000-0000-0000-0000-000000000003','c6730000-0000-0000-0000-000000000002'],'each Conversation keeps the time of its newest message');

-- Another Company's reader, and nobody signed in, read nothing.
select set_config('request.jwt.claim.sub','b6730000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.conversation_list('10000000-0000-0000-0000-000000000001')),0,'someone outside the Company reads nothing');
select is(public.conversation_counts('10000000-0000-0000-0000-000000000001'),'{"current":0,"archived":0}'::jsonb,'and counts nothing');
reset role;
select ok(not has_function_privilege('anon','public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text)','execute'),'nobody signed out may ask');

select * from finish();
rollback;
