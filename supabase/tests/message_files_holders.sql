begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
-- #727: two sends of one key that overlap the other way round from #598. The first keeps its rows; the second finds
-- them still there, adds none and writes its images at the paths they name; then the first gives its rows back. The
-- rows stay while the second still holds them, so the discard names no path and the server removes nothing; the last
-- attempt that gives them back takes them, and a hold no send let go of lapses. The previous app version's discard, which
-- names no attempt, keeps its meaning. RS Learning: Omar (1) is Owner.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f7270000-0000-0000-0000-000000000001','Overlap','General',false,'default');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a7270000-0000-0000-0000-000000000001','Overlap');
create temporary table removed(path text) on commit drop;
grant select, insert, delete on removed to authenticated;
create function pg_temp.conversation_paths() returns setof text language sql security definer as $$
 select path from public.conversation_attachments where send_key='d7270000-0000-0000-0000-000000000001' order by position
$$;
create function pg_temp.channel_paths() returns setof text language sql security definer as $$
 select path from public.channel_attachments where send_key='d7270000-0000-0000-0000-000000000002' order by position
$$;
-- A hold whose last reserve was sixteen minutes ago.
create function pg_temp.lapse() returns void language sql security definer as $$
 update public.conversation_attachments set held_at=now()-interval '16 minutes' where send_key='d7270000-0000-0000-0000-000000000001'
$$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

-- A Conversation: A keeps two images, B of the same key finds them, then A gives them back.
select is(public.reserve_conversation_files('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000001',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10},{"position":1,"name":"b.png","content_type":"image/png","size":10}]'::jsonb,
 'e7270000-0000-0000-0000-00000000000a'),2,'send A keeps two images');
select is(public.reserve_conversation_files('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000001',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10},{"position":1,"name":"b.png","content_type":"image/png","size":10}]'::jsonb,
 'e7270000-0000-0000-0000-00000000000b'),2,'send B of the same key finds them and adds none');
insert into removed select public.discard_conversation_files('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000001',
 'e7270000-0000-0000-0000-00000000000a');
select is((select count(*)::int from removed),0,'A''s discard names no path while B still holds the rows');
select is((select count(*)::int from pg_temp.conversation_paths()),2,'and B''s rows stay');
-- A discard that names an attempt that never held them changes nothing.
insert into removed select public.discard_conversation_files('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000001',
 'e7270000-0000-0000-0000-00000000000c');
select is((select count(*)::int from removed),0,'nor one from an attempt that never held them');
-- B then gives them back too: the last holder takes them, and the server removes their paths.
insert into removed select public.discard_conversation_files('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000001',
 'e7270000-0000-0000-0000-00000000000b');
select is((select count(*)::int from removed),2,'the last attempt that gives them back takes both');
select is((select count(*)::int from pg_temp.conversation_paths()),0,'and no row is left');
select throws_ok($$select public.discard_conversation_files('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000001',null)$$,
 '22023',null,'a discard that names an attempt names one');
-- A hold nobody let go of (a send that stored its turn, or whose server stopped) lapses: a later discard takes the rows.
delete from removed;
select is(public.reserve_conversation_files('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000001',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10}]'::jsonb,'e7270000-0000-0000-0000-00000000000d'),1,'a send keeps one image and never lets go');
insert into removed select public.discard_conversation_files('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000001',
 'e7270000-0000-0000-0000-00000000000a');
select is((select count(*)::int from removed),0,'while its hold is live, another send''s discard leaves the row');
select pg_temp.lapse();
insert into removed select public.discard_conversation_files('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000001',
 'e7270000-0000-0000-0000-00000000000a');
select is((select count(*)::int from removed),1,'once it has lapsed, a later discard takes it');
-- The previous app version's discard names no attempt and takes every waiting row of the key, as it did.
delete from removed;
select is(public.reserve_conversation_files('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000001',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10}]'::jsonb,'e7270000-0000-0000-0000-00000000000e'),1,'a send of the previous version keeps one image under its attempt');
insert into removed select public.discard_conversation_files('c7270000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000001');
select is((select count(*)::int from removed),1,'and its discard, which names no attempt, takes it as before');

-- A channel, the same way.
delete from removed;
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000002',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10}]'::jsonb,'e7270000-0000-0000-0000-00000000000a'),1,'channel send A keeps its image');
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000002',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10}]'::jsonb,'e7270000-0000-0000-0000-00000000000b'),1,'channel send B finds it');
insert into removed select public.discard_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000002',
 'e7270000-0000-0000-0000-00000000000a');
select is((select count(*)::int from removed)+(select count(*)::int from pg_temp.channel_paths()),1,'A''s discard leaves the row B holds and names no path');
insert into removed select public.discard_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d7270000-0000-0000-0000-000000000002',
 'e7270000-0000-0000-0000-00000000000b');
select is((select count(*)::int from removed),1,'B''s discard, the last, takes it');

select * from finish();
rollback;
