begin;
create extension if not exists pgtap with schema extensions;
select plan(47);
-- #465: a send's images are not given back (discard_conversation_files) while its key is a queued turn that has neither
-- started nor failed, or holds a Run reservation that is not abandoned: an attempted start, one marked unknown, a retry
-- of either, or one reserved and not yet started. Once the turn settles in an ordinary way, they are given back as
-- before. RS Learning: Omar (1) is Owner, 3 a Contributor, 4 a Viewer.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a4650000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f4650000-0000-0000-0000-000000000001','Kept','General',false,'default');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('c4650000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a4650000-0000-0000-0000-000000000001','Kept'
 from generate_series(1,6) n;

-- One image kept under a send key, as the send route keeps it before the Agent is asked.
create function pg_temp.keep(conversation uuid, message_key uuid) returns integer language sql as $$
 select public.reserve_conversation_files(conversation,'10000000-0000-0000-0000-000000000001',message_key,
  '[{"position":0,"name":"chart.png","content_type":"image/png","size":10,"path":"ignored"}]'::jsonb)
$$;
create function pg_temp.discard(conversation uuid, message_key uuid) returns integer language sql as $$
 select count(*)::integer from public.discard_conversation_files(conversation,'10000000-0000-0000-0000-000000000001',message_key)
$$;
create function pg_temp.rows(message_key uuid) returns integer language sql security definer as $$
 select count(*)::integer from public.conversation_attachments where send_key=message_key
$$;
create function pg_temp.reserve(conversation uuid, message_key uuid) returns text language sql as $$
 select public.reserve_conversation_turn(conversation,'10000000-0000-0000-0000-000000000001','a4650000-0000-0000-0000-000000000001',message_key,'Look at this')->>'state'
$$;
grant execute on all functions in schema pg_temp to authenticated,service_role;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

-- An attempted start: a refused or erroring resend of the same key leaves its file, and the Run's record takes it.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(pg_temp.reserve('c4650000-0000-0000-0000-000000000001','d4650000-0000-0000-0000-000000000001'),'reserved','a message with an image reserves its Run');
select is(pg_temp.keep('c4650000-0000-0000-0000-000000000001','d4650000-0000-0000-0000-000000000001'),1,'and keeps its image');
reset role;
set local role service_role;
select is(public.begin_start('c4650000-0000-0000-0000-000000000001','d4650000-0000-0000-0000-000000000001'),1,'its start is attempted');
reset role;
set local role authenticated;
select is(pg_temp.discard('c4650000-0000-0000-0000-000000000001','d4650000-0000-0000-0000-000000000001'),0,'a refused resend of an attempted start gives no path back');
select is(pg_temp.rows('d4650000-0000-0000-0000-000000000001'),1,'and its file row stays');
select is(pg_temp.keep('c4650000-0000-0000-0000-000000000001','d4650000-0000-0000-0000-000000000001'),-1,
 'a resend keeping its images again is told they are kept: the server writes nothing over them');
select is(public.release_conversation_run('c4650000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','d4650000-0000-0000-0000-000000000001',0),false,
 'a resend that made no attempt of its own cannot release it');
select is(pg_temp.discard('c4650000-0000-0000-0000-000000000001','d4650000-0000-0000-0000-000000000001'),0,'so the file is still kept');
select is(public.send_conversation_message('c4650000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a4650000-0000-0000-0000-000000000001','Look at this',
 'd4650000-0000-0000-0000-000000000001','run_465_1','f4650000-0000-0000-0000-000000000001'),true,'the attempted start is then recorded');
select is((select count(*)::int from public.conversation_attachments a join public.conversation_messages m on m.id=a.message_id
 where a.send_key='d4650000-0000-0000-0000-000000000001' and a.path='10000000-0000-0000-0000-000000000001/conversations/c4650000-0000-0000-0000-000000000001/d4650000-0000-0000-0000-000000000001-0'),
 1,'and its message takes the same file it was sent with');
select is(pg_temp.discard('c4650000-0000-0000-0000-000000000001','d4650000-0000-0000-0000-000000000001'),0,'a stored message''s file is never given back, as before');

-- A start marked unknown, its retry by the worker, and its later record.
select is(pg_temp.reserve('c4650000-0000-0000-0000-000000000002','d4650000-0000-0000-0000-000000000002'),'reserved','another message reserves its Run');
select is(pg_temp.keep('c4650000-0000-0000-0000-000000000002','d4650000-0000-0000-0000-000000000002'),1,'and keeps its image');
reset role;
set local role service_role;
select is(public.begin_start('c4650000-0000-0000-0000-000000000002','d4650000-0000-0000-0000-000000000002'),1,'its start is attempted');
select is(public.keep_unknown_start('c4650000-0000-0000-0000-000000000002','d4650000-0000-0000-0000-000000000002'),true,'and its answer is lost: the start is marked unknown');
reset role;
set local role authenticated;
select is(pg_temp.discard('c4650000-0000-0000-0000-000000000002','d4650000-0000-0000-0000-000000000002'),0,'a resend of a start marked unknown gives no path back');
select is(pg_temp.keep('c4650000-0000-0000-0000-000000000002','d4650000-0000-0000-0000-000000000002'),-1,'nor does it keep them again');
select is(pg_temp.reserve('c4650000-0000-0000-0000-000000000002','d4650000-0000-0000-0000-000000000002'),'queued','the resend finds it waiting');
reset role;
set local role service_role;
select is((select retry::text||' '||has_files::text from public.claim_conversation_turn('c4650000-0000-0000-0000-000000000002')),'true true','the worker claims it as a retry that carries its files');
select is((select path from public.conversation_attachments where send_key='d4650000-0000-0000-0000-000000000002'),
 '10000000-0000-0000-0000-000000000001/conversations/c4650000-0000-0000-0000-000000000002/d4650000-0000-0000-0000-000000000002-0','and reads the file it starts with');
select throws_ok($$delete from public.conversation_attachments where send_key='d4650000-0000-0000-0000-000000000002'$$,'42501',null,'but never removes it');
select is(public.begin_start('c4650000-0000-0000-0000-000000000002','d4650000-0000-0000-0000-000000000002'),2,'and asks again');
reset role;
set local role authenticated;
select is(pg_temp.discard('c4650000-0000-0000-0000-000000000002','d4650000-0000-0000-0000-000000000002'),0,'a resend during the retry gives no path back');
select is(pg_temp.rows('d4650000-0000-0000-0000-000000000002'),1,'and its file row stays');
reset role;
set local role service_role;
select is(public.record_conversation_turn('c4650000-0000-0000-0000-000000000002','d4650000-0000-0000-0000-000000000002','run_465_2','f4650000-0000-0000-0000-000000000001'),true,'the retry is recorded');
reset role;
select is((select message_id is not null from public.conversation_attachments where send_key='d4650000-0000-0000-0000-000000000002'),true,'and its message takes its file');

-- A queued turn nobody attempted, and the reservation ahead of it: both hold their files until they settle.
set local role authenticated;
select is(pg_temp.reserve('c4650000-0000-0000-0000-000000000003','d4650000-0000-0000-0000-000000000031'),'reserved','a first message reserves its Run');
select is(pg_temp.keep('c4650000-0000-0000-0000-000000000003','d4650000-0000-0000-0000-000000000031'),1,'with its image');
select is(pg_temp.reserve('c4650000-0000-0000-0000-000000000003','d4650000-0000-0000-0000-000000000032'),'queued','a second waits behind it');
select is(pg_temp.keep('c4650000-0000-0000-0000-000000000003','d4650000-0000-0000-0000-000000000032'),1,'with its image');
select is(pg_temp.discard('c4650000-0000-0000-0000-000000000003','d4650000-0000-0000-0000-000000000032'),0,'a waiting turn''s resend gives no path back');
select is(pg_temp.keep('c4650000-0000-0000-0000-000000000003','d4650000-0000-0000-0000-000000000032'),-1,'and keeps nothing over its image');
select is(pg_temp.discard('c4650000-0000-0000-0000-000000000003','d4650000-0000-0000-0000-000000000031'),0,'nor does a Run reserved and not yet started');
-- The engine refused the first before any attempt: its sender releases it, and its file goes, as today.
select is(public.release_conversation_run('c4650000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','d4650000-0000-0000-0000-000000000031',0),true,'the refused first send is released');
select is(pg_temp.discard('c4650000-0000-0000-0000-000000000003','d4650000-0000-0000-0000-000000000031'),1,'and then gives its file back');
reset role;
set local role service_role;
select lives_ok($$select public.fail_conversation_turn('c4650000-0000-0000-0000-000000000003','d4650000-0000-0000-0000-000000000032',0)$$,'the waiting turn fails for its sender');
reset role;
set local role authenticated;
select is(pg_temp.discard('c4650000-0000-0000-0000-000000000003','d4650000-0000-0000-0000-000000000032'),1,'and a failed turn''s file is given back, so none is held forever');
select is(pg_temp.keep('c4650000-0000-0000-0000-000000000003','d4650000-0000-0000-0000-000000000032'),1,'and a send of that key keeps its images as any send does');

-- The one-day limit on an unknown start fails its turn and abandons it: its file goes then too.
select is(pg_temp.reserve('c4650000-0000-0000-0000-000000000004','d4650000-0000-0000-0000-000000000004'),'reserved','a message reserves its Run');
select is(pg_temp.keep('c4650000-0000-0000-0000-000000000004','d4650000-0000-0000-0000-000000000004'),1,'and keeps its image');
reset role;
set local role service_role;
select is(public.begin_start('c4650000-0000-0000-0000-000000000004','d4650000-0000-0000-0000-000000000004')+public.keep_unknown_start('c4650000-0000-0000-0000-000000000004','d4650000-0000-0000-0000-000000000004')::int,2,
 'its start is attempted and marked unknown');
reset role;
update public.conversation_run_reservations set start_unknown_at=now()-interval '2 days' where send_key='d4650000-0000-0000-0000-000000000004';
set local role service_role;
select ok(public.abandon_conversation_reservations()>=1,'a day later the worker abandons it');
reset role;
set local role authenticated;
select is(pg_temp.discard('c4650000-0000-0000-0000-000000000004','d4650000-0000-0000-0000-000000000004'),1,'and an abandoned reservation''s file is given back');

-- Who may give them back is unchanged: only the Conversation's own person, and never a Viewer.
select is(pg_temp.keep('c4650000-0000-0000-0000-000000000005','d4650000-0000-0000-0000-000000000005'),1,'a refused first send of a new message keeps its image');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select throws_ok($$select pg_temp.discard('c4650000-0000-0000-0000-000000000005','d4650000-0000-0000-0000-000000000005')$$,'P0002','conversationNotFound','another Member cannot give back someone else''s file');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select throws_ok($$select pg_temp.discard('c4650000-0000-0000-0000-000000000005','d4650000-0000-0000-0000-000000000005')$$,'42501','conversationNotAllowed','a Viewer gives back nothing');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(pg_temp.discard('c4650000-0000-0000-0000-000000000005','d4650000-0000-0000-0000-000000000005'),1,'and its own sender''s refused send gives it back, as today');
reset role;
select * from finish();
rollback;
