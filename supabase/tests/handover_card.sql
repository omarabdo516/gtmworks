begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
-- #147. RS Learning: Lead on the Company's profile, Ads and Writer on profiles of their own. The Contributor (…03) is
-- shown Ads and not Writer; the Manager (…02) is shown Writer; the Viewer (…04) writes nothing.
insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy,skills_shared) values
 ('a1470000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',1,public.engine_tool_policy(),true),
 ('a1470000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001',1,public.engine_tool_policy(),true);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a1470000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','f1470000-0000-0000-0000-000000000011','Lead','General',true,'co-10000000000000000000000000000001'),
 ('a1470000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','f1470000-0000-0000-0000-000000000012','Ads','Runs the Meta ads.',false,'ag-a1470000000000000000000000000012'),
 ('a1470000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','f1470000-0000-0000-0000-000000000013','Writer','Writes for search.',false,'ag-a1470000000000000000000000000013');
insert into public.company_profiles(company_id,profile,tools_level,tools_policy,skills_shared) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy(),true);
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1470000-0000-0000-0000-000000000012'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a1470000-0000-0000-0000-000000000013');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c1470000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a1470000-0000-0000-0000-000000000011','Lead'),
 ('c1470000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a1470000-0000-0000-0000-000000000011','Lead'),
 ('c1470000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a1470000-0000-0000-0000-000000000011','Lead'),
 ('c1470000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','a1470000-0000-0000-0000-000000000011','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c1470000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','عمر','Plan the March intake',gen_random_uuid(),'run-owner'),
 ('10000000-0000-0000-0000-000000000001','c1470000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000002','مدير','Plan the April intake',gen_random_uuid(),'run-manager'),
 ('10000000-0000-0000-0000-000000000001','c1470000-0000-0000-0000-000000000003','person','20000000-0000-0000-0000-000000000003','مراجع','Plan the June intake',gen_random_uuid(),'run-contributor'),
 ('10000000-0000-0000-0000-000000000001','c1470000-0000-0000-0000-000000000004','person','20000000-0000-0000-0000-000000000004','مشاهد','Plan the July intake',gen_random_uuid(),'run-viewer');
-- The Contributor's chat already has a Card, made for Writer, in Ideas: a handover gives it the Agent handed the work.
insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id)
 select '10000000-0000-0000-0000-000000000001',s.id,'Plan the June intake','a1470000-0000-0000-0000-000000000013','c1470000-0000-0000-0000-000000000003'
 from public.work_stages s where s.company_id='10000000-0000-0000-0000-000000000001' and s.position=1;
create temporary table kept as select id as card,stage_id,agent_id from public.work_cards where conversation_id='c1470000-0000-0000-0000-000000000003';

-- A chat with no Card makes one under "In progress" for the Agent handed the work, titled as #144's Card is, once.
select is(public.lead_hand_to_agent('c1470000-0000-0000-0000-000000000001','run-owner','call-1',' Ads ','Plan the Meta ads for the March intake','EGP 9,000 for 30 days.'),
 '{"state":"created","agent":"Ads"}'::jsonb,'the Lead keeps a handover to an Agent of its Company');
select is((select count(*)::int from public.work_cards where conversation_id='c1470000-0000-0000-0000-000000000001'),1,'and one Card follows it');
select is((select w.title||':'||w.agent_id||':'||s.board_column||':'||s.kind from public.work_cards w join public.work_stages s on s.id=w.stage_id and s.company_id=w.company_id
 where w.conversation_id='c1470000-0000-0000-0000-000000000001'),
 'Plan the March intake:a1470000-0000-0000-0000-000000000012:progress:before_review','under In progress, for Ads, titled from the person''s first message and tied to the Conversation');
select is(public.lead_hand_to_agent('c1470000-0000-0000-0000-000000000001','run-owner','call-1','Ads','Plan it again',null),'{"state":"created","agent":"Ads"}'::jsonb,'the same call again answers the same');
select is((select count(*)::int from public.work_cards where conversation_id='c1470000-0000-0000-0000-000000000001'),1,'and keeps one Card');
select is((select count(*)::int from public.company_log where source='agent_handovers'),1,'with one log row');
select is((select l.actor_id||'|'||l.actor_kind||'|'||l.agent_id||'|'||l.subject||'|'||l.action||'|'||(l.details->>'to_name')||'|'||(l.details->>'goal') from public.company_log l join public.work_cards w on w.id=l.card_id
 where l.source='agent_handovers'),
 'a1470000-0000-0000-0000-000000000011|agent|a1470000-0000-0000-0000-000000000012|card|agent_handed_to|Ads|Plan the Meta ads for the March intake','on the Card: Lead handed it to Ads, with the job');
select is((select w.created_at=l.created_at from public.work_cards w join public.company_log l on l.card_id=w.id where l.source='agent_handovers'),true,'the handover''s own moment');

-- A chat that has a Card gives it the Agent handed the work, keeps its stage, and logs the handover on it.
select is(public.lead_hand_to_agent('c1470000-0000-0000-0000-000000000003','run-contributor','call-2',' Ads ','Plan the June intake',''),'{"state":"created","agent":"Ads"}'::jsonb,'a Contributor''s handover is kept');
select is((select count(*)::int from public.work_cards where conversation_id='c1470000-0000-0000-0000-000000000003'),1,'the Conversation keeps its one Card');
select is((select w.id||':'||w.agent_id||':'||w.stage_id from public.work_cards w where w.conversation_id='c1470000-0000-0000-0000-000000000003'),
 (select card||':a1470000-0000-0000-0000-000000000012:'||stage_id from kept),'with Ads and its stage, nothing else changed');
select is((select count(*)::int from public.company_log l join public.work_cards w on w.id=l.card_id where w.conversation_id='c1470000-0000-0000-0000-000000000003' and l.action='agent_handed_to'),1,'and the handover''s log row on it');

-- A Viewer's Conversation hands nothing over, so no Card follows; a call to an Agent nobody sees makes none either.
select is(public.lead_hand_to_agent('c1470000-0000-0000-0000-000000000004','run-viewer','call-1','Ads','Plan',''),'{"state":"refused"}'::jsonb,'a Viewer''s Conversation hands nothing over');
select is((select count(*)::int from public.work_cards where conversation_id='c1470000-0000-0000-0000-000000000004'),0,'so no Card follows it');
select is(public.lead_hand_to_agent('c1470000-0000-0000-0000-000000000002','run-manager','call-3','Writer','Plan',''),'{"state":"created","agent":"Writer"}'::jsonb,'a handed job to an Agent of the Company is kept');
select is((select count(*)::int from public.work_cards where conversation_id='c1470000-0000-0000-0000-000000000002'),1,'and its Card follows');

-- The row is on the Card for every Member who sees both Agents: the Contributor sees Lead and Ads, not Writer.
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,created_at) values
 ('10000000-0000-0000-0000-000000000001','c1470000-0000-0000-0000-000000000001','run-owner','call-9','a1470000-0000-0000-0000-000000000011','a1470000-0000-0000-0000-000000000013','A hidden one',now());
insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
 select '10000000-0000-0000-0000-000000000001','a1470000-0000-0000-0000-000000000011','agent','Lead','card',w.id,'a1470000-0000-0000-0000-000000000013','agent_handed_to',
  jsonb_build_object('agent_name','Lead','to_name','Writer','goal','A hidden one'),'agent_handovers',h.id,h.created_at
 from public.agent_handovers h join public.work_cards w on w.conversation_id=h.conversation_id where h.call_id='call-9';
select is((select string_agg(l.details->>'to_name',',' order by l.id) from public.company_log l where l.action='agent_handed_to' and l.card_id=(select card from kept)),'Ads','on the Card of the Contributor''s own chat, its one row');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select string_agg(l.details->>'to_name',',' order by l.id) from public.company_log l where l.action='agent_handed_to'),'Ads,Ads','the Contributor reads the rows of the Agents they see, not the hidden one');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select string_agg(l.details->>'to_name',',' order by l.id) from public.company_log l where l.action='agent_handed_to'),'Ads,Ads,Writer,Writer','the Owner reads every row of the Agents the row is about');
reset role;

-- #354: two handovers race for a chat that had no Card. The second's insert finds the first's Card and does nothing:
-- it still gives that Card its own Agent, keeping the Card's stage and title.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c1470000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a1470000-0000-0000-0000-000000000011','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c1470000-0000-0000-0000-000000000005','person','20000000-0000-0000-0000-000000000001','عمر','Plan the September intake',gen_random_uuid(),'run-race');
-- The other handover's Card lands between this call's read and its insert, as a racing transaction's committed card would.
create function pg_temp.race_card() returns trigger language plpgsql as $$
begin
 if pg_trigger_depth()=1 then
  insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id)
   values(new.company_id,new.stage_id,'The other handover''s card',(select id from public.hermes_agents where company_id=new.company_id and name='Writer'),new.conversation_id);
 end if;
 return new;
end $$;
create trigger race_card before insert on public.work_cards for each row execute function pg_temp.race_card();
select is(public.lead_hand_to_agent('c1470000-0000-0000-0000-000000000005','run-race','call-1','Ads','Plan the September intake',null),
 '{"state":"created","agent":"Ads"}'::jsonb,'a handover whose Card raced another keeps its handover');
drop trigger race_card on public.work_cards;
select is((select w.title||':'||w.agent_id||':'||s.board_column||':'||s.kind from public.work_cards w join public.work_stages s on s.id=w.stage_id and s.company_id=w.company_id
 where w.conversation_id='c1470000-0000-0000-0000-000000000005'),
 'The other handover''s card:a1470000-0000-0000-0000-000000000012:progress:before_review','the raced Card keeps its title and stage, and takes the Agent handed the work');
select is((select count(*)::int from public.company_log l join public.work_cards w on w.id=l.card_id
 where w.conversation_id='c1470000-0000-0000-0000-000000000005' and l.action='agent_handed_to'),1,'and its row lands on that one Card');
select * from finish();
rollback;
