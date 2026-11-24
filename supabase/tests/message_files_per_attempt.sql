begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- #598: two sends of one key that interleave across a discard. The first keeps its rows, gives them back (the server
-- would then remove the paths the discard returned), and the second keeps them again before that removal: its rows name
-- other paths, so the removal never reaches what it writes. A send that finds the rows still there is given the rows
-- they already are, and a Conversation keeps one row per place. RS Learning: Omar (1) is Owner.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a5980000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f5980000-0000-0000-0000-000000000001','Twice','General',false,'default');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c5980000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a5980000-0000-0000-0000-000000000001','Twice');
create temporary table removed(path text) on commit drop;
grant select, insert, delete on removed to authenticated;
create function pg_temp.conversation_paths() returns setof text language sql security definer as $$
 select path from public.conversation_attachments where send_key='d5980000-0000-0000-0000-000000000001' order by position
$$;
create function pg_temp.channel_paths() returns setof text language sql security definer as $$
 select path from public.channel_attachments where send_key='d5980000-0000-0000-0000-000000000002' order by position
$$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);

-- A Conversation: the first send keeps two images, then gives them back.
select is(public.reserve_conversation_files('c5980000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d5980000-0000-0000-0000-000000000001',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10},{"position":1,"name":"b.png","content_type":"image/png","size":10}]'::jsonb,
 'e5980000-0000-0000-0000-00000000000a'),2,'the first send keeps two images under its attempt');
select results_eq('select * from pg_temp.conversation_paths()',$$values
 ('10000000-0000-0000-0000-000000000001/conversations/c5980000-0000-0000-0000-000000000001/d5980000-0000-0000-0000-000000000001-e5980000-0000-0000-0000-00000000000a-0'),
 ('10000000-0000-0000-0000-000000000001/conversations/c5980000-0000-0000-0000-000000000001/d5980000-0000-0000-0000-000000000001-e5980000-0000-0000-0000-00000000000a-1')$$,
 'its rows name its own attempt');
select is(public.reserve_conversation_files('c5980000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d5980000-0000-0000-0000-000000000001',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10},{"position":1,"name":"b.png","content_type":"image/png","size":10}]'::jsonb,
 'e5980000-0000-0000-0000-00000000000c'),2,'a send that finds its rows still there adds no second row at a place');
select is((select count(*)::int from pg_temp.conversation_paths() path where path like '%-e5980000-0000-0000-0000-00000000000a-%'),2,
 'and is given the paths the rows already name');
insert into removed select public.discard_conversation_files('c5980000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d5980000-0000-0000-0000-000000000001');
select is((select count(*)::int from removed),2,'the discard gives back both paths, which the server then removes');
-- Before that removal, the second send of the key keeps its images again.
select is(public.reserve_conversation_files('c5980000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d5980000-0000-0000-0000-000000000001',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10},{"position":1,"name":"b.png","content_type":"image/png","size":10}]'::jsonb,
 'e5980000-0000-0000-0000-00000000000b'),2,'the second send keeps them again');
select is((select count(*)::int from pg_temp.conversation_paths() path where path in (select path from removed)),0,
 'and none of its paths is one the first send''s removal takes');
-- A retry from the previous app version, which still calls the four-argument reserve, adds no second row at a place.
select is(public.reserve_conversation_files('c5980000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d5980000-0000-0000-0000-000000000001',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10},{"position":1,"name":"b.png","content_type":"image/png","size":10}]'::jsonb),2,
 'a previous version''s retry of the key finds the same two rows');
select is((select count(*)::int from pg_temp.conversation_paths() path where path like '%-e5980000-0000-0000-0000-00000000000b-%'),2,
 'and adds none beside them at its old paths');
select throws_ok($$select public.reserve_conversation_files('c5980000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d5980000-0000-0000-0000-000000000003',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10}]'::jsonb,null)$$,'22023',null,'a keep names its attempt');

-- A channel, the same way.
delete from removed;
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d5980000-0000-0000-0000-000000000002',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10}]'::jsonb,'e5980000-0000-0000-0000-00000000000a'),1,'a channel send keeps its image under its attempt');
insert into removed select public.discard_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d5980000-0000-0000-0000-000000000002');
select is((select count(*)::int from removed),1,'and gives it back');
select is(public.reserve_channel_files('69000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d5980000-0000-0000-0000-000000000002',
 '[{"position":0,"name":"a.png","content_type":"image/png","size":10}]'::jsonb,'e5980000-0000-0000-0000-00000000000b'),1,'the second send keeps it again');
select is((select count(*)::int from pg_temp.channel_paths() path where path in (select path from removed)),0,
 'at a path the first send''s removal never takes');

select * from finish();
rollback;
