begin;
create extension if not exists pgtap with schema extensions;
select plan(30);
-- RS Learning with Lead (main) and Ads. Ads is shown to the Manager, the first Contributor (…03) and the Viewer, and
-- hidden from the second Contributor (…05). Each Card below has Ads but one, and none has a chat yet.
set constraints public.conversation_reply_card immediate;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a1450000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c1450000-0000-0000-0000-000000000001','Lead','General',true,'sheet-lead'),
 ('a1450000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','c1450000-0000-0000-0000-000000000002','Ads','Runs the Meta ads.',false,'sheet-ads');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',p,'a1450000-0000-0000-0000-000000000002'
 from unnest(array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[]) p;
update public.people set name='Youssef Adel' where id='20000000-0000-0000-0000-000000000003';
create temporary table cards(name text primary key, id bigint) on commit drop;
grant select on cards to authenticated,service_role;
with made as (insert into public.work_cards(company_id,stage_id,title,agent_id)
 select '10000000-0000-0000-0000-000000000001',s.id,x.title,x.agent from (values
  ('ideas','ideas','An idea for Ads','a1450000-0000-0000-0000-000000000002'::uuid),('planned','planned','A planned brief for Ads','a1450000-0000-0000-0000-000000000002'),
  ('progress','progress','Ads at work already','a1450000-0000-0000-0000-000000000002'),('no agent','ideas','An idea with nobody',null),
  ('hidden','ideas','Another idea for Ads','a1450000-0000-0000-0000-000000000002')) x(name,col,title,agent)
 join lateral (select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and board_column=x.col and kind<>'after_review' order by position,id limit 1) s on true
 returning id,title)
insert into cards select x.name,made.id from made join (values ('ideas','An idea for Ads'),('planned','A planned brief for Ads'),('progress','Ads at work already'),
 ('no agent','An idea with nobody'),('hidden','Another idea for Ads')) x(name,title) on x.title=made.title;
create function pg_temp.card(name text) returns bigint language sql stable as $$ select id from cards where cards.name=card.name $$;
create function pg_temp.column_of(card bigint) returns text language sql stable as $$ select s.board_column from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.id=card $$;
create function pg_temp.as_person(person text) returns void language sql as $$
 select set_config('request.jwt.claims','{"aal":"aal1"}',true), set_config('request.jwt.claim.sub',person,true) $$;
grant execute on function pg_temp.card(text),pg_temp.column_of(bigint),pg_temp.as_person(text) to authenticated,service_role;
select set_config('test.cards',(select count(*)::text from public.work_cards where company_id='10000000-0000-0000-0000-000000000001'),true);

set local role authenticated;
select pg_temp.as_person('20000000-0000-0000-0000-000000000003');
select is(public.start_card_conversation('10000000-0000-0000-0000-000000000001',pg_temp.card('ideas'),'e1450000-0000-0000-0000-000000000001'),'e1450000-0000-0000-0000-000000000001'::uuid,
 'a Contributor who sees Ads starts the chat on an idea of Ads');
select results_eq($$select v.person_id,v.agent_id,v.agent_name,w.conversation_id from public.conversations v join public.work_cards w on w.conversation_id=v.id where w.id=pg_temp.card('ideas')$$,
 $$values ('20000000-0000-0000-0000-000000000003'::uuid,'a1450000-0000-0000-0000-000000000002'::uuid,'Ads'::text,'e1450000-0000-0000-0000-000000000001'::uuid)$$,
 'the chat is theirs, with Ads, tied to the Card');
select is(pg_temp.column_of(pg_temp.card('ideas')),'progress','and the Card moved from Ideas to In progress');
select results_eq($$select action,actor_id,actor_kind,details->>'field',details->>'old_name',details->>'new_name' from public.company_log where card_id=pg_temp.card('ideas') and action<>'card_created' order by id$$,
 $$select 'card_changed'::text,'20000000-0000-0000-0000-000000000003'::uuid,'person'::text,'stage_id'::text,
  (select name from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and board_column='ideas' order by position limit 1),
  (select name from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and board_column='progress' and kind='before_review' order by position limit 1)$$,
 'besides its making, the log has one row: the move, by the Contributor, as a board move writes it');
select is(public.start_card_conversation('10000000-0000-0000-0000-000000000001',pg_temp.card('ideas'),'e1450000-0000-0000-0000-000000000001'),'e1450000-0000-0000-0000-000000000001'::uuid,
 'starting it again with the same id returns the same chat');
select is(public.start_card_conversation('10000000-0000-0000-0000-000000000001',pg_temp.card('ideas'),'e1450000-0000-0000-0000-000000000009'),'e1450000-0000-0000-0000-000000000001'::uuid,
 'and with another id (a second tab) returns the first');
select is((select count(*)::int from public.company_log where card_id=pg_temp.card('ideas') and action<>'card_created'),1,'neither adds a log row');
select is((select count(*)::int from public.conversations where id='e1450000-0000-0000-0000-000000000009'),0,'nor a second chat');
select lives_ok($$select public.start_card_conversation('10000000-0000-0000-0000-000000000001',pg_temp.card('planned'),'e1450000-0000-0000-0000-000000000002')$$,'a Card in Planned starts a chat');
select is(pg_temp.column_of(pg_temp.card('planned')),'progress','and moves to In progress');
select lives_ok($$select public.start_card_conversation('10000000-0000-0000-0000-000000000001',pg_temp.card('progress'),'e1450000-0000-0000-0000-000000000003')$$,'a Card already in progress starts a chat');
select is((select stage_id from public.work_cards where id=pg_temp.card('progress')),(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and board_column='progress' and kind<>'after_review' order by position,id limit 1),
 'and stays where it was');
select is((select count(*)::int from public.company_log where card_id=pg_temp.card('progress') and action<>'card_created'),0,'with no log row');
select throws_ok($$select public.start_card_conversation('10000000-0000-0000-0000-000000000001',pg_temp.card('no agent'),'e1450000-0000-0000-0000-000000000004')$$,'P0002','conversationNotFound',
 'a Card with no Agent has no one to start a chat with');
select throws_ok($$select public.start_card_conversation('10000000-0000-0000-0000-000000000001',pg_temp.card('hidden'),'e1450000-0000-0000-0000-000000000001')$$,'P0002','conversationNotFound',
 'an id that already names a chat is never taken over');
select throws_ok($$select public.start_card_conversation('10000000-0000-0000-0000-000000000001',0,'e1450000-0000-0000-0000-000000000005')$$,'P0002','conversationNotFound','nor is a Card that does not exist');

select pg_temp.as_person('20000000-0000-0000-0000-000000000004');
select throws_ok($$select public.start_card_conversation('10000000-0000-0000-0000-000000000001',pg_temp.card('hidden'),'e1450000-0000-0000-0000-000000000006')$$,'42501','conversationNotAllowed',
 'the Viewer cannot start a chat');
select pg_temp.as_person('20000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.work_cards where id=pg_temp.card('hidden')),0,'the second Contributor does not read the untied Card of Ads, hidden from them (#367)');
select throws_ok($$select public.start_card_conversation('10000000-0000-0000-0000-000000000001',pg_temp.card('hidden'),'e1450000-0000-0000-0000-000000000007')$$,'P0002','conversationNotFound',
 'and cannot start a chat with Ads, which is hidden from them');
select pg_temp.as_person('20000000-0000-0000-0000-000000000002');
select throws_ok($$select public.start_card_conversation('10000000-0000-0000-0000-000000000001',pg_temp.card('ideas'),'e1450000-0000-0000-0000-000000000008')$$,'42501','cardChatTaken',
 'the Manager cannot start a second chat on a Card that has one');
select pg_temp.as_person('20000000-0000-0000-0000-000000000001');
select throws_ok($$select public.start_card_conversation('10000000-0000-0000-0000-000000000001',pg_temp.card('ideas'),'e1450000-0000-0000-0000-000000000008')$$,'42501','cardChatTaken',
 'nor can the Owner');
select is((select count(*)::int from public.conversations where id='e1450000-0000-0000-0000-000000000008'),0,'and no chat was made for either');

-- The first message and its reply: the reply's Card is the one already tied, so the board gains none.
select pg_temp.as_person('20000000-0000-0000-0000-000000000003');
select ok(public.send_conversation_message('e1450000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a1450000-0000-0000-0000-000000000002','Plan three ads for this idea',gen_random_uuid(),'sheet-run-1'),
 'the Contributor writes the first message');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.close_conversation_run('e1450000-0000-0000-0000-000000000001','sheet-run-1','completed','On it.','s-1',10,2),true,'Ads replies');
reset role;
select is((select count(*)::int from public.work_cards where conversation_id='e1450000-0000-0000-0000-000000000001'),1,'the chat has one Card, the one it started from');
select is((select count(*)::text from public.work_cards where company_id='10000000-0000-0000-0000-000000000001'),current_setting('test.cards'),'and the board has no new Card');

-- Only its person reads the chat; every other Member who sees the Card reads its person's first name.
set local role authenticated;
select pg_temp.as_person('20000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.conversation_messages where conversation_id='e1450000-0000-0000-0000-000000000001'),2,'its person reads the message and the reply');
create temporary table seen(person text, chats int, messages int, first_name text) on commit drop;
grant insert,select on seen to authenticated;
select pg_temp.as_person('20000000-0000-0000-0000-000000000001');
insert into seen select 'owner',(select count(*) from public.conversations where id='e1450000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1450000-0000-0000-0000-000000000001'),public.card_chat_person('10000000-0000-0000-0000-000000000001',pg_temp.card('ideas'));
select pg_temp.as_person('20000000-0000-0000-0000-000000000002');
insert into seen select 'manager',(select count(*) from public.conversations where id='e1450000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1450000-0000-0000-0000-000000000001'),public.card_chat_person('10000000-0000-0000-0000-000000000001',pg_temp.card('ideas'));
select pg_temp.as_person('20000000-0000-0000-0000-000000000004');
insert into seen select 'viewer',(select count(*) from public.conversations where id='e1450000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1450000-0000-0000-0000-000000000001'),public.card_chat_person('10000000-0000-0000-0000-000000000001',pg_temp.card('ideas'));
select pg_temp.as_person('20000000-0000-0000-0000-000000000005');
insert into seen select 'hidden from Ads',(select count(*) from public.conversations where id='e1450000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1450000-0000-0000-0000-000000000001'),public.card_chat_person('10000000-0000-0000-0000-000000000001',pg_temp.card('ideas'));
select results_eq($$select person,chats,messages,first_name from seen order by person$$,
 $$values ('hidden from Ads'::text,0,0,null::text),('manager'::text,0,0,'Youssef'::text),('owner'::text,0,0,'Youssef'::text),('viewer'::text,0,0,'Youssef'::text)$$,
 'the Owner, the Manager and the Viewer read neither the chat nor a message of it, only whose it is; a Member Ads is hidden from reads not even that');
select is(public.card_chat_person('10000000-0000-0000-0000-000000000001',pg_temp.card('hidden')),null,'an untied Card has no one''s chat');
reset role;
select ok(not has_function_privilege('anon','public.start_card_conversation(uuid,bigint,uuid)','execute') and not has_function_privilege('service_role','public.start_card_conversation(uuid,bigint,uuid)','execute')
 and not has_function_privilege('anon','public.card_chat_person(uuid,bigint)','execute'),'only a signed-in Member starts a Card''s chat or asks whose it is');
select * from finish();
rollback;
