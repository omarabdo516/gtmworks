begin;
create extension if not exists pgtap with schema extensions;
select plan(62);
-- #150. RS Learning: Lead on the Company's own profile, Ads and Writer on profiles of their own. The "scripts" team
-- channel holds the Owner (1), the Manager (2), the Contributor (3) and the Viewer (4), and only Lead and Ads: Writer is
-- the Company's third Agent, outside it. Member 5 is in the Company but not in the channel; Karim belongs to Aleem only.
insert into public.agent_profiles(agent_id,company_id,tools_confirmed,skills_shared) values
 ('a1500000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',true,true),
 ('a1500000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001',true,true);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,instructions) values
 ('a1500000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','f1500000-0000-0000-0000-000000000011','Lead','General',true,'co-10000000000000000000000000000001','Lead the team.'),
 ('a1500000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','f1500000-0000-0000-0000-000000000012','Ads','Ads',false,'ag-a1500000000000000000000000000012','Run the Meta ads.'),
 ('a1500000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','f1500000-0000-0000-0000-000000000013','Writer','SEO',false,'ag-a1500000000000000000000000000013','Write for search.');
insert into public.company_profiles(company_id,profile,skills_shared,tools_confirmed) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',true,true);
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('c1500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','team','scripts','20000000-0000-0000-0000-000000000003','e1500000-0000-0000-0000-000000000001');
insert into public.channel_people(channel_id,company_id,person_id,added_by) values
 ('c1500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003'),
 ('c1500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003'),
 ('c1500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003'),
 ('c1500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000003');
insert into public.channel_agents(channel_id,company_id,agent_id,added_by) values
 ('c1500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000003'),
 ('c1500000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000003');
insert into auth.users(id,email) values ('e1509000-0000-0000-0000-000000000001','karim.handovers@example.test');
insert into public.people(id,name) values ('e1509000-0000-0000-0000-000000000001','Karim');
insert into public.members(company_id,person_id,role) values ('10000000-0000-0000-0000-000000000003','e1509000-0000-0000-0000-000000000001','manager');

-- The messages whose Runs make the calls: the Owner's and the Contributor's to Lead, the Viewer's to Lead, and the
-- Owner's to Ads (an Agent that never hands work on).
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','c1500000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','@Lead plan the March ads',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','c1500000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000003','مراجع','@Lead plan the June ads',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','c1500000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000004','مشاهد','@Lead plan it all',gen_random_uuid()),
 ('10000000-0000-0000-0000-000000000001','c1500000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','@Ads write the launch',gen_random_uuid());
select set_config('test.owner',(select min(id)::text from public.channel_messages where body='@Lead plan the March ads'),true);
select set_config('test.writer',(select id::text from public.channel_messages where body='@Lead plan the June ads'),true);
select set_config('test.viewer',(select id::text from public.channel_messages where body='@Lead plan it all'),true);
select set_config('test.ads',(select id::text from public.channel_messages where body='@Ads write the launch'),true);
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at,outcome,closed_at)
 select id,1,'10000000-0000-0000-0000-000000000001','c1500000-0000-0000-0000-000000000001',
  case when body='@Ads write the launch' then 'a1500000-0000-0000-0000-000000000012'::uuid else 'a1500000-0000-0000-0000-000000000011'::uuid end,
  case when body='@Ads write the launch' then 'Ads' else 'Lead' end,gen_random_uuid(),body,
  case when body='@Lead plan the March ads' then 'run-lead' when body='@Lead plan the June ads' then 'run-writer'
   when body='@Lead plan it all' then 'run-viewer' else 'run-ads' end,
  case when body='@Ads write the launch' then 'ag-a1500000000000000000000000000012' else 'co-10000000000000000000000000000001' end,
  1,now(),null,null
 from public.channel_messages where channel_id='c1500000-0000-0000-0000-000000000001';

-- Who may hand work over there: a writer of the channel talking to its Lead, and no one else.
select is(public.channel_can_hand_over('c1500000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-000000000011'),true,'the Owner hands work over to the Lead in the channel');
select is(public.channel_can_hand_over('c1500000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a1500000-0000-0000-0000-000000000011'),true,'and so does the Manager');
select is(public.channel_can_hand_over('c1500000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-000000000011'),true,'and the Contributor');
select is(public.channel_can_hand_over('c1500000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a1500000-0000-0000-0000-000000000011'),false,'a Viewer writes nothing, so hands nothing over');
select is(public.channel_can_hand_over('c1500000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','a1500000-0000-0000-0000-000000000011'),false,'a Member outside the channel hands nothing over');
select is(public.channel_can_hand_over('c1500000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-000000000012'),false,'another Agent never hands work on');

-- The Agents the Run is told it may hand to: the channel's others, never the Company's third.
select is(public.channel_handover_agents(current_setting('test.owner')::bigint),array['Ads'],'the Lead''s channel Run is told the channel''s other Agent alone');
select is(public.channel_handover_agents(current_setting('test.writer')::bigint),array['Ads'],'a Contributor''s call is told the same');
select is(public.channel_handover_agents(current_setting('test.viewer')::bigint),'{}'::text[],'a Viewer''s Run is told no Agent');
select is(public.channel_handover_agents(current_setting('test.ads')::bigint),'{}'::text[],'and an Agent that may not hand over is told none');

-- The handover tool is pinned with the Run, and only for the Agent that may hand over.
select set_config('test.specs','{"show_draft":"{\"name\":\"show_draft\"}","show_review":"{\"name\":\"show_review\"}","hand_over":"{\"name\":\"hand_over\"}","hand_to_agent":"{\"name\":\"hand_to_agent\"}"}',true);
set local role service_role;
select ok(public.pin_channel_run(current_setting('test.owner')::bigint,current_setting('test.specs')::jsonb)->>'tools' like '%"hand_to_agent"%','the Lead''s channel Run is offered the handover, pinned with it');
select is(public.pin_channel_run(current_setting('test.ads')::bigint,current_setting('test.specs')::jsonb)->>'tools' like '%"hand_to_agent"%',false,'an Agent that may not hand over is offered none');
reset role;

-- The handover Lead''s call keeps: once per message, run and call, to an Agent of the channel alone.
select is(public.channel_hand_to_agent(current_setting('test.owner')::bigint,'run-lead','call-1',' Ads ','Plan the Meta ads for the March intake','EGP 9,000 for 30 days.'),
 '{"state":"created","agent":"Ads"}'::jsonb,'the Lead keeps a handover to an Agent of its channel');
select is((select from_agent||'>'||to_agent||':'||state||':'||goal||':'||context||':'||channel_message_id||':'||(conversation_id is null)::text
 from public.agent_handovers where run_id='run-lead'),
 'a1500000-0000-0000-0000-000000000011>a1500000-0000-0000-0000-000000000012:waiting:Plan the Meta ads for the March intake:EGP 9,000 for 30 days.:'
 ||current_setting('test.owner')||':true','from the Lead to Ads, waiting, linked to the channel message and no Conversation');
select is(public.channel_hand_to_agent(current_setting('test.owner')::bigint,'run-lead','call-1','Ads','Plan it again',null),'{"state":"created","agent":"Ads"}'::jsonb,'the same call again answers the same');
select is((select count(*)::int from public.agent_handovers),1,'and keeps one handover');
select is(public.channel_hand_to_agent(current_setting('test.owner')::bigint,'run-lead','call-2','Writer','Plan',''),'{"state":"ignored"}'::jsonb,'an Agent outside the channel is no target');
select is(public.channel_hand_to_agent(current_setting('test.owner')::bigint,'run-lead','call-3','Lead','Plan',''),'{"state":"ignored"}'::jsonb,'and the Lead never hands work to itself');
select is(public.channel_hand_to_agent(current_setting('test.owner')::bigint,'run-lead','call-4','Nobody','Plan',''),'{"state":"ignored"}'::jsonb,'a name no Agent of the channel has is ignored');
select is(public.channel_hand_to_agent(current_setting('test.viewer')::bigint,'run-viewer','call-1','Ads','Plan',''),'{"state":"refused"}'::jsonb,'a Viewer''s message hands nothing over, and its Run still closes');
select is(public.channel_hand_to_agent(current_setting('test.ads')::bigint,'run-ads','call-1','Lead','Plan',''),'{"state":"refused"}'::jsonb,'another Agent''s Run hands nothing over');
select is(public.channel_hand_to_agent(current_setting('test.owner')::bigint,'run-elsewhere','call-1','Ads','Plan',''),'{"state":"refused"}'::jsonb,'a run that is not this message''s is refused');

-- One row in the log, read by the channel's members alone.
select is((select actor_id||'|'||agent_id||'|'||action||'|'||(details->>'to_name')||'|'||(details->>'goal')||'|'||source||'|'||source_id
 from public.company_log where source='agent_handovers'),
 'a1500000-0000-0000-0000-000000000011|a1500000-0000-0000-0000-000000000012|agent_handed_to|Ads|Plan the Meta ads for the March intake|agent_handovers|'
 ||(select id::text from public.agent_handovers where run_id='run-lead'),'one log row names the Agent it went to and the job');
select is((select count(*)::int from public.company_log where source='agent_handovers'),1,'a repeat of the call writes no second row');

-- The worker moves the two Runs in the channel's own sessions.
select is((select count(*)::int from public.handovers_due(null,0,'c1500000-0000-0000-0000-000000000001')),1,'the channel''s pass sees its handover');
select is((select count(*)::int from public.handovers_due(null,0,'69000000-0000-0000-0000-000000000001')),0,'another channel sees none');
select is((select count(*)::int from public.handovers_due('c1500000-0000-0000-0000-000000000001',0,null)),0,'and a Conversation''s pass sees none of it');
create temporary table begun as select * from public.begin_handover((select id from public.agent_handovers where run_id='run-lead'));
select is((select profile||':'||session||':'||instructions from begun),
 'ag-a1500000000000000000000000000012:'||md5('c1500000-0000-0000-0000-000000000001:'||'a1500000-0000-0000-0000-000000000012')::uuid||':Run the Meta ads.',
 'the target''s own profile, in the session it has in this channel, with its own instructions');
select ok((select input from begun) like '%Plan the Meta ads for the March intake%' and (select input from begun) like '%EGP 9,000 for 30 days.%'
 and (select input from begun) like '%in this channel%'
 and (select input from begun) like '%Do not save anything to memory, do not schedule anything, and do not hand the job on.%',
 'the job, its context and the channel go with it, and the target is told not to use the memory and cronjob tools its own profile keeps, nor hand the job on');
select is((select count(*)::int from public.begin_handover((select id from public.agent_handovers where run_id='run-lead'))),0,'nor does it start again within thirty seconds');
select is(public.answer_handover((select id from public.agent_handovers where run_id='run-lead'),1,'run-target'),true,'the target''s Run is kept once');
select is((select state||':'||run from public.handovers_due(null,0,'c1500000-0000-0000-0000-000000000001')),'target:run-target','and is read on the target''s profile');
select is(public.close_handover_target((select id from public.agent_handovers where run_id='run-lead'),'run-target','completed','Three ad sets, 30 days, EGP 9,000.'),true,'the target''s Run ends with what it reported');
select is((select state||':'||target_outcome||':'||summary||':'||(target_closed_at is not null)::text from public.agent_handovers where run_id='run-lead'),
 'returning:completed:Three ad sets, 30 days, EGP 9,000.:true','and the handover keeps when the answer came in');
create temporary table returned as select * from public.begin_handover((select id from public.agent_handovers where run_id='run-lead'));
select is((select profile||':'||session||':'||attempt from returned),
 'co-10000000000000000000000000000001:'||md5('c1500000-0000-0000-0000-000000000001:'||'a1500000-0000-0000-0000-000000000011')::uuid||':1',
 'the follow-up goes to the Lead on the Company''s profile, in Lead''s own session of the channel');
select ok((select input from returned) like '%Three ad sets, 30 days, EGP 9,000.%' and (select input from returned) like '%Write your reply to the team%','with what the target reported, to answer to the team');
select is(public.answer_handover((select id from public.agent_handovers where run_id='run-lead'),1,'run-return'),true,'the follow-up Run is kept once');
select is(public.close_handover_follow_up((select id from public.agent_handovers where run_id='run-lead'),'run-return','completed','Ads planned the March intake: three ad sets.'),true,'Lead''s reply closes the handover');
select is((select state||':'||follow_up_outcome||':'||reply from public.agent_handovers where run_id='run-lead'),
 'done:completed:Ads planned the March intake: three ad sets.','and is kept on the handover for the channel to draw');
select is((select count(*)::int from public.channel_messages where channel_id='c1500000-0000-0000-0000-000000000001'),4,'no message of it is written: the channel draws the record');
select is(public.close_handover_follow_up((select id from public.agent_handovers where run_id='run-lead'),'run-return','completed','Again'),false,'closing it again stores nothing');

-- What the channel's members read: the whole handover, the row in the table and its line in the log, each per Role and
-- never outside the channel or the Company.
create temporary table seen(who int, reads int, drawn text, logged int);
grant insert on seen to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into seen select 1,(select count(*)::int from public.channel_handovers('c1500000-0000-0000-0000-000000000001')),
 (select from_name||'>'||to_name||':'||goal||':'||summary||':'||reply from public.channel_handovers('c1500000-0000-0000-0000-000000000001')),
 (select count(*)::int from public.company_log where source='agent_handovers');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into seen select 2,(select count(*)::int from public.channel_handovers('c1500000-0000-0000-0000-000000000001')),null,
 (select count(*)::int from public.company_log where source='agent_handovers');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
insert into seen select 3,(select count(*)::int from public.channel_handovers('c1500000-0000-0000-0000-000000000001')),null,
 (select count(*)::int from public.company_log where source='agent_handovers');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
insert into seen select 4,(select count(*)::int from public.channel_handovers('c1500000-0000-0000-0000-000000000001')),null,
 (select count(*)::int from public.company_log where source='agent_handovers');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
insert into seen select 5,(select count(*)::int from public.channel_handovers('c1500000-0000-0000-0000-000000000001')),null,
 (select count(*)::int from public.company_log where source='agent_handovers');
select set_config('request.jwt.claim.sub','e1509000-0000-0000-0000-000000000001',true);
insert into seen select 6,(select count(*)::int from public.channel_handovers('c1500000-0000-0000-0000-000000000001')),null,
 (select count(*)::int from public.company_log where source='agent_handovers');
reset role;
select is((select reads from seen where who=1),1,'the Owner reads the channel''s handover');
select is((select drawn from seen where who=1),'Lead>Ads:Plan the Meta ads for the March intake:Three ad sets, 30 days, EGP 9,000.:Ads planned the March intake: three ad sets.','with both Agents, the job, the target''s answer and Lead''s reply');
select is((select reads from seen where who=2),1,'the Manager reads it');
select is((select reads from seen where who=3),1,'the Contributor reads it');
select is((select reads from seen where who=4),1,'the Viewer reads it too');
select is((select reads from seen where who=5),0,'a Member of the Company outside the channel reads none of it');
select is((select reads from seen where who=6),0,'and another Company reads none');
select is((select string_agg(who::text||':'||logged,',' order by who) from seen),'1:1,2:1,3:1,4:1,5:0,6:0','its log row is read by the channel''s members alone');

-- The table itself answers none of it: a channel's handover is read through channel_handovers alone, so no channel member
-- reads its row (and the Engine run id it keeps) from the table. Only one place is a handover's.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.agent_handovers),0,'the Owner, in the channel, reads no handover row from the table');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select count(*)::int from public.agent_handovers),0,'nor does a Contributor');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.agent_handovers),0,'nor the Viewer, who reads the channel''s record');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.agent_handovers),0,'and a Member outside the channel reads no row either');
reset role;
select throws_ok($$insert into public.agent_handovers(company_id,run_id,call_id,from_agent,to_agent,goal) values
 ('10000000-0000-0000-0000-000000000001','run-x','call-x','a1500000-0000-0000-0000-000000000011','a1500000-0000-0000-0000-000000000012','Plan')$$,
 '23514',null,'a handover is a Conversation''s or a channel message''s, never neither');
select throws_ok($$insert into public.agent_handovers(company_id,conversation_id,channel_message_id,run_id,call_id,from_agent,to_agent,goal) values
 ('10000000-0000-0000-0000-000000000001','c1500000-0000-0000-0000-000000000009',current_setting('test.owner')::bigint,'run-y','call-y',
  'a1500000-0000-0000-0000-000000000011','a1500000-0000-0000-0000-000000000012','Plan')$$,
 '23514',null,'nor both');

-- Grants: the worker moves and keeps a handover, a Member reads the channel''s record, and nobody else calls the rest.
select is((select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute')
  and not has_function_privilege('anon',f,'execute')) from unnest(array['public.channel_hand_to_agent(bigint,text,text,text,text,text)',
  'public.channel_handover_agents(bigint)','public.handovers_due(uuid,bigint,uuid)','public.begin_handover(bigint)',
  'public.close_handover_target(bigint,text,text,text)','public.close_handover_follow_up(bigint,text,text,text)',
  'public.pin_channel_run(bigint,jsonb)']) f),true,'the worker''s functions are the service role''s alone');
select is(has_function_privilege('authenticated','public.channel_handovers(uuid)','execute')
 and not has_function_privilege('anon','public.channel_handovers(uuid)','execute')
 and not has_function_privilege('service_role','public.channel_handovers(uuid)','execute'),true,'a channel''s record is read by signed-in members only');
select is((select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['public','anon','authenticated','service_role']) r,
 unnest(array['public.channel_can_hand_over(uuid,uuid,uuid)']) f),true,'and who may hand over stays private');
select is(has_function_privilege('authenticated','public.handover_in_channel(bigint)','execute')
 and not has_function_privilege('anon','public.handover_in_channel(bigint)','execute')
 and has_function_privilege('authenticated','public.handover_in_my_channel(bigint)','execute')
 and not has_function_privilege('anon','public.handover_in_my_channel(bigint)','execute'),true,'the log''s rules answer a signed-in reader');

-- #354: a queued channel handover re-checks that its target is still callable in the channel when its Run would start.
-- One since removed from the channel starts no Run: the leg ends as failed, so Lead still tells the team.
insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key) values
 ('10000000-0000-0000-0000-000000000001','c1500000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','@Lead plan the July ads',gen_random_uuid());
select set_config('test.removed',(select max(id)::text from public.channel_messages where channel_id='c1500000-0000-0000-0000-000000000001'),true);
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at)
 values (current_setting('test.removed')::bigint,1,'10000000-0000-0000-0000-000000000001','c1500000-0000-0000-0000-000000000001',
  'a1500000-0000-0000-0000-000000000011','Lead',gen_random_uuid(),'@Lead plan the July ads','run-removed','co-10000000000000000000000000000001',1,now());
select is(public.channel_hand_to_agent(current_setting('test.removed')::bigint,'run-removed','call-1','Ads','Plan the July ads',null),
 '{"state":"created","agent":"Ads"}'::jsonb,'a job is kept for an Agent callable in the channel');
delete from public.channel_agents where channel_id='c1500000-0000-0000-0000-000000000001' and agent_id='a1500000-0000-0000-0000-000000000012';
select is((select count(*)::int from public.begin_handover((select id from public.agent_handovers where run_id='run-removed'))),0,
 'an Agent since removed from the channel starts no Run');
select is((select state||':'||target_outcome||':'||target_attempts from public.agent_handovers where run_id='run-removed'),'returning:failed:0',
 'the leg ends as failed, so Lead still reports it to the team');
select * from finish();
rollback;
