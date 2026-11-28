begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
-- #881 (spec #864): the sidebar and All conversations list a person's Conversations from their rows joined with the
-- Engine's sessions, beside the channels they are in (channel_list); an archive is the session's own mark, and the
-- database logs who archived or restored (log_conversations_archived); a row whose session is gone is forgotten by the
-- worker alone (conversation_drift, forget_conversations), never one the old record still holds.
-- RS Learning's Manager (…02) is in the team channel "spring"; the Viewer (…04) is not. Ari runs on profile "list-chat".
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a8810000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c8810000-0000-0000-0000-000000000001','Ari','Writes the posts.',false,'list-chat');
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a8810000-0000-0000-0000-000000000001');
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('e8810000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','team','spring','20000000-0000-0000-0000-000000000002','e8817000-0000-0000-0000-000000000001');
insert into public.channel_people(channel_id,company_id,person_id,added_by) values
 ('e8810000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002');
-- "Old" was archived the old way (its mark and the worker's both set); "Fresh" is new, "Gone" an old one the Engine no
-- longer holds, "Kept" an old one the old record still holds a message of, and "Orphan" one whose Agent was deleted.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id,created_at,archived_at,archived_by,session_archived) values
 ('c8810000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a8810000-0000-0000-0000-000000000001','Ari','session-old',now()-interval '2 days',now()-interval '1 day','20000000-0000-0000-0000-000000000002',true),
 ('c8810000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a8810000-0000-0000-0000-000000000001','Ari','session-fresh',now(),null,null,null),
 ('c8810000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a8810000-0000-0000-0000-000000000001','Ari','session-gone',now()-interval '2 days',null,null,null),
 ('c8810000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a8810000-0000-0000-0000-000000000001','Ari','session-kept',now()-interval '2 days',null,null,null),
 ('c8810000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',null,'Bea','session-orphan',now()-interval '2 days',null,null,null);
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,agent_id,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c8810000-0000-0000-0000-000000000004','person','20000000-0000-0000-0000-000000000002','مدير',null,'Kept','e8811000-0000-0000-0000-000000000001','kept-run');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select ok('spring'=any(array(select name from public.channel_list('10000000-0000-0000-0000-000000000001'))),'a person lists the channels they are in');
select is((select count(*)::int from public.channel_list('10000000-0000-0000-0000-000000000001',archived=>true)),0,'and none archived under Archived');
select is(array(select v::text from public.log_conversations_archived('10000000-0000-0000-0000-000000000001',array['c8810000-0000-0000-0000-000000000001','c8810000-0000-0000-0000-000000000002']::uuid[],false) v order by 1),
 array['c8810000-0000-0000-0000-000000000001','c8810000-0000-0000-0000-000000000002'],'a restore is logged for each of their own');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select ok(not exists(select 1 from public.channel_list('10000000-0000-0000-0000-000000000001') where name='spring'),'a person not in the channel does not list it');
select is_empty($$select * from public.log_conversations_archived('10000000-0000-0000-0000-000000000001',array['c8810000-0000-0000-0000-000000000002']::uuid[],true)$$,'nobody logs an archive of another person''s Conversation');
select throws_ok($$select public.conversation_drift()$$,'42501',null,'a person cannot list the sessions to check');
select throws_ok($$select public.forget_conversations('10000000-0000-0000-0000-000000000001',array['session-gone'])$$,'42501',null,'nor forget a row');
reset role;

select is((select count(*)::int from public.conversation_archives where conversation_id='c8810000-0000-0000-0000-000000000001' and action='restored'),1,'who restored it is kept');
select ok((select archived_at is null and session_archived is null from public.conversations where id='c8810000-0000-0000-0000-000000000001'),
 'the old mark and the old worker''s are cleared, so the worker never writes the session''s mark back');
select is((select count(*)::int from public.conversations x where x.hermes_session_id is not null and (x.archived_at is not null) is distinct from coalesce(x.session_archived,false) and x.id::text like 'c881%'),0,'and the worker has no mark to carry');
select is(array(select coalesce(profile,'')||':'||array_to_string(sessions,',') from public.conversation_drift() where company_id='10000000-0000-0000-0000-000000000001' and ('session-old'=any(sessions) or 'session-orphan'=any(sessions))),
 array[':session-orphan','list-chat:session-gone,session-kept,session-old'],'the worker lists the sessions an hour old or more, by profile, an Agent that is gone with none');
set local role service_role;
select is(public.forget_conversations('10000000-0000-0000-0000-000000000001',array['session-gone','session-kept','session-fresh','session-orphan']),2,'the worker forgets the rows whose sessions are gone');
reset role;
select is(array(select id::text from public.conversations where id::text like 'c881%' order by 1),
 array['c8810000-0000-0000-0000-000000000001','c8810000-0000-0000-0000-000000000002','c8810000-0000-0000-0000-000000000004'],'a new one and one the old record still holds are kept');
select is((select count(*)::int from public.conversation_messages where conversation_id='c8810000-0000-0000-0000-000000000004'),1,'and no message of the old record is deleted');
select * from finish();
rollback;
