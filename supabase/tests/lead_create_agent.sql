begin;
create extension if not exists pgtap with schema extensions;
select plan(28);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('e0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Lead','General',true,'co-10000000000000000000000000000001');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('e1000000-0000-0000-0000-00000000000'||n)::uuid,'10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,'e0000000-0000-0000-0000-000000000002','Lead' from generate_series(1,4) n;
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('e1000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone','I want someone to handle Meta ads',gen_random_uuid(),'run-'||n from generate_series(1,4) n;

set local role service_role;
select results_eq($$select public.lead_create_agent(('e1000000-0000-0000-0000-00000000000'||n)::uuid,'run-'||n,'call-0','Meta Ads','Runs the Meta ads.','{Meta Ads Manager}')->>'state' from generate_series(2,4) n order by n$$,
 $$values ('refused'),('refused'),('refused')$$,'the call in the Manager''s, the Contributor''s and the Viewer''s Conversation is refused');
reset role;
select is((select count(*)::int from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001'),1,'no Agent is made for them');
select is((select count(*)::int from public.company_log where agent_id is not null and action<>'agent_provided' and company_id='10000000-0000-0000-0000-000000000001'),0,'nor an Agent change');
select is((select count(*)::int from public.lead_made_agents),0,'nor a record of the call');
select is((select count(*)::int from public.company_log where action='agent_requested'),0,'nor a log row');

set local role service_role;
select is(public.lead_create_agent('e1000000-0000-0000-0000-000000000001','run-1','call-0',' Meta Ads ','Runs the Meta ads.','{Meta Ads Manager, Canva}')->>'state','created','the same call in the Owner''s Conversation makes the Agent');
select is(public.lead_create_agent('e1000000-0000-0000-0000-000000000001','run-1','call-1','Meta Ads','Runs the Meta ads.','{x,x,x,x,x,x,x,x,x}')->>'state','invalid','a call with nine apps makes nothing');
select is(public.lead_create_agent('e1000000-0000-0000-0000-000000000001','run-9','call-0','Meta Ads','Runs the Meta ads.','{}')->>'state','refused','a run that is not in the Conversation makes nothing');
reset role;
select is(public.lead_create_agent('e1000000-0000-0000-0000-000000000001','run-1','call-0','Other','Other job','{}')->>'agent',(select id::text from public.hermes_agents where name='Meta Ads'),'the same run and call again answer the Agent they made');
select is((select count(*)::int from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001'),2,'and make nothing more');
select ok(exists(select 1 from public.hermes_agents a
  where a.name='Meta Ads' and a.speciality='Runs the Meta ads.' and a.apps='{Meta Ads Manager,Canva}' and a.requested_by='20000000-0000-0000-0000-000000000001'
   and a.created_at is not null and a.requester_opened_at is null and not a.is_default
   and a.profile='co-10000000000000000000000000000001'),
 'the Agent has its job, apps, requester and made date, and runs on the Company''s profile');
select is((select count(*)::int from public.company_log where action='agent_requested' and actor_id='20000000-0000-0000-0000-000000000001' and actor_kind='person'
  and details->>'agent_name'='Meta Ads' and details->>'job'='Runs the Meta ads.'),1,'the log has one row: the Owner asked for it, with its name and job');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.lead_made_agents),0,'another Member does not read the Owner''s record of the call');
select is(public.open_hermes_agent((select id from public.hermes_agents where name='Meta Ads')),false,'nor clears its new mark');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select results_eq($$select l.run_id,a.name from public.lead_made_agents l join public.hermes_agents a on a.id=l.agent_id where l.conversation_id='e1000000-0000-0000-0000-000000000001'$$,
 $$values ('run-1','Meta Ads')$$,'the Owner reads the call''s record with its Agent');
select is(public.open_hermes_agent((select id from public.hermes_agents where name='Meta Ads')),true,'its requester clears the new mark');
select is(public.open_hermes_agent((select id from public.hermes_agents where name='Meta Ads')),false,'once');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.mark_agent_toast_shown((select id from public.hermes_agents where name='Meta Ads')),false,'another Member is not its requester');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.mark_agent_toast_shown((select id from public.hermes_agents where name='Meta Ads')),true,'its requester is told it was made once (#169)');
select is(public.mark_agent_toast_shown((select id from public.hermes_agents where name='Meta Ads')),false,'and not again');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.mark_agent_born((select id from public.hermes_agents where name='Meta Ads')),false,'another Member does not see it born');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.mark_agent_born((select id from public.hermes_agents where name='Meta Ads')),true,'its requester sees it born once (#701)');
select is(public.mark_agent_born((select id from public.hermes_agents where name='Meta Ads')),false,'and not again: a reload, another device');

reset role;
set local role service_role;
select is(public.lead_create_agent(conversation=>'e1000000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-2',agent_name=>'Writer',job=>'Writes the blog.',apps=>'{WordPress}',
  template=>'writer',instructions=>'You write for {company}. Keep to {company}''s voice.')->>'state','created','a call from a ready-made role makes the Agent');
select is(public.lead_create_agent(conversation=>'e1000000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-3',agent_name=>'Writer',job=>'Writes the blog.',apps=>'{}',
  template=>'writer',instructions=>repeat('x',8001))->>'state','invalid','instructions over 8000 characters make nothing');
reset role;
select results_eq($$select template,instructions from public.hermes_agents where name='Writer'$$,
 $$values ('writer','You write for RS Learning. Keep to RS Learning''s voice.')$$,'the Agent keeps its role and the role''s instructions, fitted with the Company''s name');
select is((select action from public.company_log where agent_id=(select id from public.hermes_agents where name='Writer')),'agent_requested','its log row names the Agent''s making');
select ok((select template is null and instructions is null from public.hermes_agents where name='Meta Ads'),'an Agent made without a role has neither');
select * from finish();
rollback;
