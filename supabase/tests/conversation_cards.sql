begin;
create extension if not exists pgtap with schema extensions;
select plan(46);
-- RS Learning with Lead (main) and Ads. Ads is shown to the Manager, both Contributors and the Viewer; the first
-- Contributor (…03) starts every Conversation below. The Card is made when the reply's transaction ends, so here it is
-- judged at once, as a Run closed in its own transaction is; the deferral itself is checked near the end.
set constraints public.conversation_reply_card immediate;
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
 ('c1440000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','cards-lead','ciphertext','connected'),
 ('c1440000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','cards-ads','ciphertext','connected');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('a1440000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c1440000-0000-0000-0000-000000000001','Lead','General',true),
 ('a1440000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','c1440000-0000-0000-0000-000000000002','Ads','Runs the Meta ads.',false);
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',p,'a1440000-0000-0000-0000-000000000002'
 from unnest(array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000005']::uuid[]) p;
create temporary table chats(n int, conversation uuid, agent uuid, message text) on commit drop;
grant select on chats to authenticated,service_role;
insert into chats values
 (1,'e1440000-0000-0000-0000-000000000001','a1440000-0000-0000-0000-000000000002','@Ads /plan Plan the June campaign for the accounting course with three ads'||E'\nKeep it short'),
 (2,'e1440000-0000-0000-0000-000000000002','a1440000-0000-0000-0000-000000000002','@Ads'),
 (3,'e1440000-0000-0000-0000-000000000003','a1440000-0000-0000-0000-000000000002','This one fails'),
 (4,'e1440000-0000-0000-0000-000000000004','a1440000-0000-0000-0000-000000000002','Stop this one'),
 (5,'e1440000-0000-0000-0000-000000000005','a1440000-0000-0000-0000-000000000002','من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها'),
 (6,'e1440000-0000-0000-0000-000000000006','a1440000-0000-0000-0000-000000000002','Make me an agent for the leads'),
 (7,'e1440000-0000-0000-0000-000000000007','a1440000-0000-0000-0000-000000000002','Ask the Owner for an agent for the leads'),
 (8,'e1440000-0000-0000-0000-000000000008','a1440000-0000-0000-0000-000000000001','Plan the launch week'),
 (9,'e1440000-0000-0000-0000-000000000009','a1440000-0000-0000-0000-000000000002','Draft the teaser'),
 (10,'e1440000-0000-0000-0000-000000000010','a1440000-0000-0000-0000-000000000002','From now on write short captions');
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from chats where public.send_conversation_message(conversation,'10000000-0000-0000-0000-000000000001',agent,message,gen_random_uuid(),'cards-run-'||n)),10,
 'the Contributor starts ten Conversations');
select ok(public.send_conversation_message('e1440000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','a1440000-0000-0000-0000-000000000002','And again',gen_random_uuid(),'cards-run-3b')
 and public.send_conversation_message('e1440000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','a1440000-0000-0000-0000-000000000002','And again',gen_random_uuid(),'cards-run-4b'),
 'and a second message in the failed and the stopped one');
reset role;

-- What each first Run left before it was closed: a rule, a made Agent, a request for one.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.agent_save_rule('e1440000-0000-0000-0000-000000000005','cards-run-5','call-0','من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها')->>'state','suggested','a rule is kept from the fifth Run');
reset role;
insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id) values
 ('e1440000-0000-0000-0000-000000000006','cards-run-6','call-0','10000000-0000-0000-0000-000000000001','a1440000-0000-0000-0000-000000000002');
insert into public.lead_agent_requests(company_id,conversation_id,run_id,call_id,asked_by,asked_with,agent_name,job,apps) values
 ('10000000-0000-0000-0000-000000000001','e1440000-0000-0000-0000-000000000007','cards-run-7','call-0','20000000-0000-0000-0000-000000000003','Ask the Owner for an agent for the leads','Leads','Follows up the leads.','{}');

set local role service_role;
select is(public.close_conversation_run('e1440000-0000-0000-0000-000000000001','cards-run-1','completed','On it.','s-1',10,2),true,'the first Run of a Conversation with Ads ends with a reply');
select is(public.close_conversation_run('e1440000-0000-0000-0000-000000000001','cards-run-1','completed','On it again.','s-1',10,2),false,'and closing it again stores nothing');
select ok(public.close_conversation_run('e1440000-0000-0000-0000-000000000002','cards-run-2','completed','Yes?','s-2',1,1),'a message that was only a mention gets its reply');
select ok(public.close_conversation_run('e1440000-0000-0000-0000-000000000003','cards-run-3','failed',null,null,null,null)
 and public.close_conversation_run('e1440000-0000-0000-0000-000000000003','cards-run-3b','completed','Done now.','s-3',1,1),'a failed first Run, then a reply to the next');
select ok(public.close_conversation_run('e1440000-0000-0000-0000-000000000004','cards-run-4','stopped',null,null,1,1)
 and public.close_conversation_run('e1440000-0000-0000-0000-000000000004','cards-run-4b','completed','Done now.','s-4',1,1),'a stopped first Run, then a reply to the next');
select ok(public.close_conversation_run('e1440000-0000-0000-0000-000000000005','cards-run-5','completed','Saved.','s-5',1,1)
 and public.close_conversation_run('e1440000-0000-0000-0000-000000000006','cards-run-6','completed','Made it.','s-6',1,1)
 and public.close_conversation_run('e1440000-0000-0000-0000-000000000007','cards-run-7','completed','Sent it.','s-7',1,1)
 and public.close_conversation_run('e1440000-0000-0000-0000-000000000008','cards-run-8','completed','Here is the plan.','s-8',1,1),
 'the Runs that saved a rule, made or asked for an Agent, and the main Agent''s, each end with a reply');
reset role;

select results_eq($$select c.title,s.board_column,s.id=(select id from public.work_stages where company_id=c.company_id and board_column='progress' order by position,id limit 1),c.agent_id,c.next_actor is null
  from public.work_cards c join public.work_stages s on s.id=c.stage_id where c.conversation_id='e1440000-0000-0000-0000-000000000001'$$,
 $$values ('Plan the June campaign for the accounting co'::text,'progress'::text,true,'a1440000-0000-0000-0000-000000000002'::uuid,true)$$,
 'one Card, in the first In progress stage, titled by the first line cut to 44 characters without the mention or the command, with Ads, waiting on nobody');
select is((select title from public.work_cards where conversation_id='e1440000-0000-0000-0000-000000000002'),'Ads','a message with nothing left in it titles its Card by the Agent');
select is((select count(*)::int from public.work_cards where conversation_id in (select conversation from chats where n between 3 and 8)),0,
 'no Card when the first Run failed or was stopped, saved a rule, made or asked for an Agent, or was the main Agent''s');
select set_config('test.card',(select id::text from public.work_cards where conversation_id='e1440000-0000-0000-0000-000000000001'),true);
select results_eq($$select action,actor_kind,actor_id is null from public.company_log where card_id=current_setting('test.card')::bigint$$,
 $$values ('card_created'::text,'system'::text,true)$$,'the log has one row for the new Card, as gtmworks');
select is((select count(*)::int from public.work_activity where card_id=current_setting('test.card')::bigint),1,'and the Card one activity row');
insert into public.work_comments(company_id,card_id,body,author_id) values ('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,'Looks good','20000000-0000-0000-0000-000000000001');
-- Its stored files: one in its own folder, one its note's attachment names; and a file of an untied Card.
insert into public.work_attachments(company_id,card_id,comment_id,name,content_type,size,path,created_by) select company_id,card_id,id,'brief.pdf','application/pdf',10,
 '10000000-0000-0000-0000-000000000001/new-card/0','20000000-0000-0000-0000-000000000001' from public.work_comments where card_id=current_setting('test.card')::bigint;
insert into storage.objects(bucket_id,name) values ('creatives','10000000-0000-0000-0000-000000000001/'||current_setting('test.card')||'/brief.pdf'),
 ('creatives','10000000-0000-0000-0000-000000000001/new-card/0'),('creatives','10000000-0000-0000-0000-000000000001/1/brief.pdf');

-- Who reads what: every Member who sees Ads reads the Card and what is written on it; only its person reads the chat.
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
create temporary table seen(person text, cards int, activity int, notes int, log int, chats int, messages int) on commit drop;
grant insert,select on seen to authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 'contributor, its person',(select count(*) from public.work_cards where id=current_setting('test.card')::bigint),
 (select count(*) from public.work_activity where card_id=current_setting('test.card')::bigint),(select count(*) from public.work_comments where card_id=current_setting('test.card')::bigint),
 (select count(*) from public.company_log where card_id=current_setting('test.card')::bigint),(select count(*) from public.conversations where id='e1440000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1440000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 'owner',(select count(*) from public.work_cards where id=current_setting('test.card')::bigint),
 (select count(*) from public.work_activity where card_id=current_setting('test.card')::bigint),(select count(*) from public.work_comments where card_id=current_setting('test.card')::bigint),
 (select count(*) from public.company_log where card_id=current_setting('test.card')::bigint),(select count(*) from public.conversations where id='e1440000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1440000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 'manager',(select count(*) from public.work_cards where id=current_setting('test.card')::bigint),
 (select count(*) from public.work_activity where card_id=current_setting('test.card')::bigint),(select count(*) from public.work_comments where card_id=current_setting('test.card')::bigint),
 (select count(*) from public.company_log where card_id=current_setting('test.card')::bigint),(select count(*) from public.conversations where id='e1440000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1440000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 'other contributor',(select count(*) from public.work_cards where id=current_setting('test.card')::bigint),
 (select count(*) from public.work_activity where card_id=current_setting('test.card')::bigint),(select count(*) from public.work_comments where card_id=current_setting('test.card')::bigint),
 (select count(*) from public.company_log where card_id=current_setting('test.card')::bigint),(select count(*) from public.conversations where id='e1440000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1440000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 'viewer',(select count(*) from public.work_cards where id=current_setting('test.card')::bigint),
 (select count(*) from public.work_activity where card_id=current_setting('test.card')::bigint),(select count(*) from public.work_comments where card_id=current_setting('test.card')::bigint),
 (select count(*) from public.company_log where card_id=current_setting('test.card')::bigint),(select count(*) from public.conversations where id='e1440000-0000-0000-0000-000000000001'),
 (select count(*) from public.conversation_messages where conversation_id='e1440000-0000-0000-0000-000000000001');
select results_eq($$select person,cards,activity,notes,log,chats,messages from seen order by person$$,
 $$values ('contributor, its person'::text,1,2,1,2,1,2),('manager'::text,1,2,1,2,0,0),('other contributor'::text,1,2,1,2,0,0),('owner'::text,1,2,1,2,0,0),('viewer'::text,1,2,1,2,0,0)$$,
 'the Owner, the Manager, a Contributor and the Viewer who see Ads read the Card, its activity, its note and its log rows, and not the chat; its person reads both');

-- Hidden from the second Contributor, Ads takes its Card with it, and nothing else on the board.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select set_config('test.untied',(select count(*)::text from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and conversation_id is null),true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_agent_visible('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','a1440000-0000-0000-0000-000000000002',false)$$,'the Owner hides Ads from the second Contributor');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.work_cards where id=current_setting('test.card')::bigint),0,'a Member Ads is hidden from does not see its Card');
select is((select count(*)::int from public.work_cards where conversation_id is not null),0,'nor any Card tied to a chat with Ads');
select is((select count(*)::int from public.work_activity where card_id=current_setting('test.card')::bigint),0,'nor its activity');
select is((select count(*)::int from public.work_comments where card_id=current_setting('test.card')::bigint),0,'nor a note on it');
select is((select count(*)::int from public.company_log where card_id=current_setting('test.card')::bigint),0,'nor its log rows');
select is((select count(*)::int from public.conversations where id='e1440000-0000-0000-0000-000000000001'),0,'nor the chat');
select is((select count(*)::text from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and conversation_id is null),current_setting('test.untied'),'while every untied Card reads as before');
select throws_ok($$select public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,'planned')$$,'P0001','card not found or not permitted','and they cannot move it');
select throws_ok($$insert into public.work_comments(company_id,card_id,body) values ('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,'Sneaking a note in')$$,'42501',null,'nor write a note on it');
select throws_ok($$insert into public.work_checklist(company_id,card_id,title) values ('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,'Sneaking a step in')$$,'42501',null,'nor add a step to it');
select is((select count(*)::int from storage.objects where bucket_id='creatives' and name in ('10000000-0000-0000-0000-000000000001/'||current_setting('test.card')||'/brief.pdf','10000000-0000-0000-0000-000000000001/new-card/0')),0,'nor read its stored files, in its folder or named by its attachment');
select is((select count(*)::int from storage.objects where bucket_id='creatives' and name='10000000-0000-0000-0000-000000000001/1/brief.pdf'),1,'while an untied Card''s file reads as before');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('creatives','10000000-0000-0000-0000-000000000001/'||current_setting('test.card')||'/sneaked.pdf')$$,'42501',null,'nor store a file in its folder');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.work_cards where id=current_setting('test.card')::bigint),1,'the Manager still sees it');
select is((select count(*)::int from storage.objects where bucket_id='creatives' and name in ('10000000-0000-0000-0000-000000000001/'||current_setting('test.card')||'/brief.pdf','10000000-0000-0000-0000-000000000001/new-card/0')),2,'and its stored files');

-- The tie is the database's: a Member who may edit Cards moves this one like any other, and never sets its chat.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',current_setting('test.card')::bigint,'planned')$$,'the Owner moves the Card');
select is((select s.board_column from public.work_cards c join public.work_stages s on s.id=c.stage_id where c.id=current_setting('test.card')::bigint),'planned','and it is in Planned, still tied');
select throws_ok($$update public.work_cards set conversation_id=null where id=current_setting('test.card')::bigint$$,'42501','cardConversationProtected','the Owner cannot untie it');
select throws_ok($$update public.work_cards set conversation_id='e1440000-0000-0000-0000-000000000009' where id=1$$,'42501','cardConversationProtected','nor tie another Card to a chat');
select throws_ok($$insert into public.work_cards(company_id,stage_id,title,conversation_id) select '10000000-0000-0000-0000-000000000001',id,'Forged','e1440000-0000-0000-0000-000000000009' from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'$$,
 '42501','cardConversationProtected','nor make a Card tied to one');
select lives_ok($$select public.create_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and kind='ideas'),'An untied idea')$$,'a Card made by hand is made as before');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$update public.work_cards set conversation_id=null where id=current_setting('test.card')::bigint$$,'42501','cardConversationProtected','the service key cannot untie it either');
select ok(not has_function_privilege('service_role','public.can_see_card(uuid,bigint)','execute') and not has_function_privilege('anon','public.can_see_card(uuid,bigint)','execute'),'only a signed-in Member asks whether they see a Card');
reset role;

-- A writer that keeps the reply and the rule in one transaction writes the rule after the reply: the Card is judged when
-- the transaction ends, so that Run makes none, and an ordinary reply makes its Card then and not before.
set constraints public.conversation_reply_card deferred;
set local role service_role;
select is(public.close_conversation_run('e1440000-0000-0000-0000-000000000010','cards-run-10','completed','Noted.','s-10',1,1),true,'a reply is stored first');
select is(public.agent_save_rule('e1440000-0000-0000-0000-000000000010','cards-run-10','call-0','From now on write short captions')->>'state','suggested','and the rule of its Run after it');
select is(public.close_conversation_run('e1440000-0000-0000-0000-000000000009','cards-run-9','completed','On the teaser.','s-9',1,1),true,'another first Run ends with a reply');
reset role;
select is((select count(*)::int from public.work_cards where conversation_id in ('e1440000-0000-0000-0000-000000000009','e1440000-0000-0000-0000-000000000010')),0,'no Card before the transaction ends');
set constraints public.conversation_reply_card immediate;
select is((select count(*)::int from public.work_cards where conversation_id='e1440000-0000-0000-0000-000000000010'),0,'then none for the Run that saved a rule');
select is((select title from public.work_cards where conversation_id='e1440000-0000-0000-0000-000000000009'),'Draft the teaser','and one for the ordinary reply');
select is((select count(*)::int from public.work_cards where conversation_id is not null),3,'three Conversations have a Card in all, one each');
select * from finish();
rollback;
