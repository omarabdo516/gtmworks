begin;
create extension if not exists pgtap with schema extensions;
select plan(25);
-- #702 (spec #694, ADR 0027): a removed Agent keeps its face in history. RS Learning has Lead (main) and Ads; Ads is
-- hidden from the Contributor (…03). Before Ads is removed: the Owner talked to Ads in a Conversation; Lead handed Ads a
-- job in the Owner's Conversation with Lead (done) and another that still waits; in the general channel the Owner called
-- Ads, Ads answered, and Lead handed Ads a job there (done); Ads has a Card it worked on. Karim belongs to Aleem only.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a7020000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f7020000-0000-0000-0000-000000000001','Lead','General',true,'default'),
 ('a7020000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f7020000-0000-0000-0000-000000000002','Ads','Ads',false,'default');
insert into auth.users(id,email) values ('e7020000-0000-0000-0000-000000000001','karim.removed@example.test');
insert into public.people(id,name) values ('e7020000-0000-0000-0000-000000000001','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','e7020000-0000-0000-0000-000000000001','manager');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('b7020000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a7020000-0000-0000-0000-000000000002','Ads'),
 ('b7020000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a7020000-0000-0000-0000-000000000001','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','b7020000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000001','عمر','Plan the ads',gen_random_uuid(),'run-1'),
 ('10000000-0000-0000-0000-000000000001','b7020000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000001','عمر','And again',gen_random_uuid(),'run-2');
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,state,target_outcome,summary,closed_at) values
 ('10000000-0000-0000-0000-000000000001','b7020000-0000-0000-0000-000000000002','run-1','call-1','a7020000-0000-0000-0000-000000000001','a7020000-0000-0000-0000-000000000002','Plan the March ads','done','completed','Planned.',now()),
 ('10000000-0000-0000-0000-000000000001','b7020000-0000-0000-0000-000000000002','run-2','call-2','a7020000-0000-0000-0000-000000000001','a7020000-0000-0000-0000-000000000002','Plan the June ads','waiting',null,null,null);
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','@Ads write the launch',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','@Lead get it written',gen_random_uuid());
select set_config('test.called',(select id::text from public.channel_messages where body='@Ads write the launch'),true);
select set_config('test.handed',(select id::text from public.channel_messages where body='@Lead get it written'),true);
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at,outcome,closed_at) values
 (current_setting('test.called')::bigint,1,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','a7020000-0000-0000-0000-000000000002','Ads',gen_random_uuid(),'@Ads write the launch','run-c','ag-a7020000000000000000000000000002',1,now(),'completed',now());
insert into public.channel_messages(company_id,channel_id,author,agent_id,author_name,body,reply_to) values
 ('10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','agent','a7020000-0000-0000-0000-000000000002','Ads','Written.',current_setting('test.called')::bigint);
insert into public.agent_handovers(company_id,channel_message_id,run_id,call_id,from_agent,to_agent,goal,state,target_outcome,summary,closed_at) values
 ('10000000-0000-0000-0000-000000000001',current_setting('test.handed')::bigint,'run-h','call-h','a7020000-0000-0000-0000-000000000001','a7020000-0000-0000-0000-000000000002','Write the launch','done','completed','Written.',now());
insert into public.work_cards(id,company_id,stage_id,title,agent_id) overriding system value
 select -7021,'10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' order by position limit 1),'Ads card','a7020000-0000-0000-0000-000000000002';
insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,source,source_id,created_at) values
 ('10000000-0000-0000-0000-000000000001','a7020000-0000-0000-0000-000000000002','agent','Ads','card',-7021,'a7020000-0000-0000-0000-000000000002','channel_reply','work_activity',-7021,now());
create temp table before_removal on commit drop as
 select shape,colour,temperament from public.agent_looks where agent_id='a7020000-0000-0000-0000-000000000002';
grant select on before_removal to authenticated;

-- 1. While Ads lives, the Contributor it is hidden from reads its look (ADR 0027) and nothing names it.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select shape,colour,temperament from public.agent_looks where agent_id='a7020000-0000-0000-0000-000000000002'$$,
 $$select * from before_removal$$,'the Contributor Ads is hidden from reads its look');
select is((select kept_name from public.agent_looks where agent_id='a7020000-0000-0000-0000-000000000002'),null,'and no name beside it while Ads lives');
select is((select to_agent::text||' '||to_name from public.channel_handovers('69000000-0000-0000-0000-000000000001')),
 'a7020000-0000-0000-0000-000000000002 Ads','the channel draws the handover to Ads for them');

-- 2. The Owner removes Ads.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','remove','a7020000-0000-0000-0000-000000000002')$$,'the Owner removes Ads');

-- 3. Its look stays, unchanged, with its name kept beside it.
select results_eq($$select shape,colour,temperament from public.agent_looks where agent_id='a7020000-0000-0000-0000-000000000002'$$,
 $$select * from before_removal$$,'Ads keeps its look');
select is((select kept_name from public.agent_looks where agent_id='a7020000-0000-0000-0000-000000000002'),'Ads','and its name beside it');

-- 4. Each record still names Ads by its id.
select is((select agent_id::text||' '||kept_agent_id::text||' '||agent_name from public.conversations where id='b7020000-0000-0000-0000-000000000001'),null,
 'the Conversation is detached from Ads');
select is((select kept_agent_id::text||' '||agent_name from public.conversations where id='b7020000-0000-0000-0000-000000000001'),'a7020000-0000-0000-0000-000000000002 Ads',
 'and keeps whose it was');
select is((select agent_id::text||' '||agent_name||' '||(connection_id is null)::text from public.conversation_list('10000000-0000-0000-0000-000000000001') where id='b7020000-0000-0000-0000-000000000001'),
 'a7020000-0000-0000-0000-000000000002 Ads true','All conversations lists it by Ads, its connection gone');
select is((select kept_agent_id::text||' '||agent_name from public.channel_runs where message_id=current_setting('test.called')::bigint),'a7020000-0000-0000-0000-000000000002 Ads',
 'the channel call keeps whom it called');
select is((select agent_id::text||' '||author_name from public.channel_messages where reply_to=current_setting('test.called')::bigint),'a7020000-0000-0000-0000-000000000002 Ads',
 'its reply keeps who wrote it');
select is((select agent_id from public.board_cards('10000000-0000-0000-0000-000000000001') where id=-7021),null,'the Card is no longer Ads''s');
select is((select kept_agent_id::text from public.board_cards('10000000-0000-0000-0000-000000000001') where id=-7021),'a7020000-0000-0000-0000-000000000002','and keeps that it was');
select is((select public.crew(b)::text from public.board_cards('10000000-0000-0000-0000-000000000001') b where b.id=-7021),'{a7020000-0000-0000-0000-000000000002}','Ads is still in its crew');
select is((select string_agg(goal||' '||from_name||' '||to_name||' '||to_agent::text,'; ') from public.conversation_handovers('b7020000-0000-0000-0000-000000000002')),
 'Plan the March ads Lead Ads a7020000-0000-0000-0000-000000000002','the Conversation keeps the handover Ads finished, Ads named; the one still waiting went with it');
select is((select to_connection is not null from public.conversation_handovers('b7020000-0000-0000-0000-000000000002')),true,
 'with a face the previous release can draw');

-- 5. For the Contributor Ads was hidden from: the same face in the channel, and its name, nothing else.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select to_agent::text||' '||to_name from public.channel_handovers('69000000-0000-0000-0000-000000000001')),
 'a7020000-0000-0000-0000-000000000002 Ads','the channel still draws the handover to Ads');
select results_eq($$select shape,colour,temperament from public.agent_looks where agent_id='a7020000-0000-0000-0000-000000000002'$$,
 $$select * from before_removal$$,'in the look it had');
select is((select kept_name from public.agent_looks where agent_id='a7020000-0000-0000-0000-000000000002'),'Ads','and its name');
select is((select count(*)::int from public.conversations where kept_agent_id='a7020000-0000-0000-0000-000000000002'),0,'not the Owner''s Conversation with it');
select is((select count(*)::int from public.agent_looks where kept_name is not null and agent_id<>'a7020000-0000-0000-0000-000000000002' and company_id='10000000-0000-0000-0000-000000000001'),0,
 'and no living Agent is named beside its look');

-- 6. Another Company reads none of it.
select set_config('request.jwt.claim.sub','e7020000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.agent_looks where agent_id='a7020000-0000-0000-0000-000000000002'),0,'another Company''s Member reads no look of Ads');
select is((select count(*)::int from public.channel_handovers('69000000-0000-0000-0000-000000000001')),0,'nor the channel''s handovers');
reset role;

-- 7. The previous release's start of a Conversation, run on this schema, keeps its Agent's id too.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('b7020000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a7020000-0000-0000-0000-000000000001','Lead');
select is((select kept_agent_id::text from public.conversations where id='b7020000-0000-0000-0000-000000000003'),'a7020000-0000-0000-0000-000000000001',
 'a Conversation started without naming the kept id keeps it');
insert into public.work_cards(id,company_id,stage_id,title,agent_id) overriding system value
 select -7022,'10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' order by position limit 1),'Lead card','a7020000-0000-0000-0000-000000000001';
update public.work_cards set agent_id=null where id=-7022;
select is((select kept_agent_id from public.work_cards where id=-7022),null,'a Card whose living Agent a person lets go names it no longer');

select * from finish();
rollback;
