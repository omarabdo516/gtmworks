begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
-- A chat tied to a Card stays its person's own Conversation (#678): a chat is no longer started from a Card, and the
-- function that did so went with the Card cutover (#684). A Card a chat made reads whose chat it is, and only for those
-- who see the Card. RS Learning with Lead (main) and Ads; Ads is shown to the Manager, the first Contributor (…03) and the
-- Viewer, and hidden from the second Contributor (…05).
set constraints public.conversation_reply_card immediate;
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a1450000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c1450000-0000-0000-0000-000000000001','Lead','General',true,'sheet-lead'),
 ('a1450000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','c1450000-0000-0000-0000-000000000002','Ads','Runs the Meta ads.',false,'sheet-ads');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',p,'a1450000-0000-0000-0000-000000000002'
 from unnest(array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[]) p;
update public.people set name='Youssef Adel' where id='20000000-0000-0000-0000-000000000003';
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e1450000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1450000-0000-0000-0000-000000000002','Ads');
insert into public.work_cards(company_id,status,title,agent_id,conversation_id) values
 ('10000000-0000-0000-0000-000000000001','progress','A chat''s Card for Ads','a1450000-0000-0000-0000-000000000002','e1450000-0000-0000-0000-000000000001');
insert into public.work_cards(company_id,status,title,agent_id) values ('10000000-0000-0000-0000-000000000001','ideas','An untied idea for Ads','a1450000-0000-0000-0000-000000000002');
select set_config('test.chat_card',(select id::text from public.work_cards where title='A chat''s Card for Ads'),true);
select set_config('test.untied',(select id::text from public.work_cards where title='An untied idea for Ads'),true);
create function pg_temp.as_person(person text) returns void language sql as $$
 select set_config('request.jwt.claims','{"aal":"aal1"}',true), set_config('request.jwt.claim.sub',person,true) $$;
grant execute on function pg_temp.as_person(text) to authenticated;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 values ('10000000-0000-0000-0000-000000000001','e1450000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','Youssef Adel','Plan three ads for this idea',gen_random_uuid(),'chat-run-1');

select ok(to_regprocedure('public.start_card_conversation(uuid,bigint,uuid)') is null,'a chat is not started from a Card');
create temporary table seen(person text, chats int, messages int, first_name text) on commit drop;
grant insert,select on seen to authenticated;
set local role authenticated;
select pg_temp.as_person('20000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.conversation_messages where conversation_id='e1450000-0000-0000-0000-000000000001'),1,'its person reads the chat');
select is(public.card_chat_person('10000000-0000-0000-0000-000000000001',current_setting('test.chat_card')::bigint),'Youssef','and whose it is');
select pg_temp.as_person('20000000-0000-0000-0000-000000000001');
insert into seen select 'owner',(select count(*) from public.conversations where id='e1450000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1450000-0000-0000-0000-000000000001'),public.card_chat_person('10000000-0000-0000-0000-000000000001',current_setting('test.chat_card')::bigint);
select pg_temp.as_person('20000000-0000-0000-0000-000000000002');
insert into seen select 'manager',(select count(*) from public.conversations where id='e1450000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1450000-0000-0000-0000-000000000001'),public.card_chat_person('10000000-0000-0000-0000-000000000001',current_setting('test.chat_card')::bigint);
select pg_temp.as_person('20000000-0000-0000-0000-000000000004');
insert into seen select 'viewer',(select count(*) from public.conversations where id='e1450000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1450000-0000-0000-0000-000000000001'),public.card_chat_person('10000000-0000-0000-0000-000000000001',current_setting('test.chat_card')::bigint);
select pg_temp.as_person('20000000-0000-0000-0000-000000000005');
insert into seen select 'hidden from Ads',(select count(*) from public.conversations where id='e1450000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1450000-0000-0000-0000-000000000001'),public.card_chat_person('10000000-0000-0000-0000-000000000001',current_setting('test.chat_card')::bigint);
select results_eq($$select person,chats,messages,first_name from seen order by person$$,
 $$values ('hidden from Ads'::text,0,0,null::text),('manager'::text,0,0,'Youssef'::text),('owner'::text,0,0,'Youssef'::text),('viewer'::text,0,0,'Youssef'::text)$$,
 'the Owner, the Manager and the Viewer read neither the chat nor a message of it, only whose it is; a Member Ads is hidden from reads not even that');
select is(public.card_chat_person('10000000-0000-0000-0000-000000000001',current_setting('test.untied')::bigint),null,'an untied Card has no one''s chat');
select pg_temp.as_person('20000000-0000-0000-0000-000000000001');
select throws_ok($$update public.work_cards set conversation_id=null where id=current_setting('test.chat_card')::bigint$$,'42501','cardConversationProtected','not even the Owner unties it');
select pg_temp.as_person('20000000-0000-0000-0000-000000000003');
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000001',current_setting('test.chat_card')::bigint,'planned')$$,'its person moves it like any other Card');
select is((select conversation_id::text from public.work_cards where id=current_setting('test.chat_card')::bigint),'e1450000-0000-0000-0000-000000000001','and it stays tied');
reset role;
select * from finish();
rollback;
