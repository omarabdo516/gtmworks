begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
-- #178: Settings shows a change an Agent proposed for its own settings while it waits for the Owner: a note on the Agent's
-- page, "Proposal waiting" on its row and a number on "Agents". Settings reads them as the reader
-- (lib/agent-change-waiting.mjs: agent_change_proposals in state waiting or applying, with the proposing Agent's name),
-- so the database alone decides who gets one: every Owner all of them; the person whose Conversation it came from theirs,
-- while they see both Agents; nobody else any.
-- RS Learning: 1 Owner, 2 Manager, 3 Contributor, 4 Viewer. Ads is shown to the Manager and the Contributor; Lead is main.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('ee000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ee000000-0000-0000-0000-000000000001','Lead','General',true,'co-10000000000000000000000000000001'),
 ('ee000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','ee000000-0000-0000-0000-000000000003','Ads','Ads',false,'waiting-test-ads');
insert into public.member_agent_access(company_id,person_id,agent_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','ee000000-0000-0000-0000-000000000004'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','ee000000-0000-0000-0000-000000000004');
-- ef…1: the Owner with Lead; ef…2: the Manager with Ads.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('ef000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','ee000000-0000-0000-0000-000000000002','Lead'),
 ('ef000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','ee000000-0000-0000-0000-000000000004','Ads');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',('ef000000-0000-0000-0000-00000000000'||n)::uuid,'person',('20000000-0000-0000-0000-00000000000'||n)::uuid,'Someone',
  'The weekly report is late again',gen_random_uuid(),'ch-'||n from unnest(array[1,2]) n;
set local role service_role;
-- Ads proposes a model for itself in the Manager's chat; Lead proposes Ads's instructions in the Owner's; an unlisted setting is refused.
select public.agent_propose_change('ef000000-0000-0000-0000-000000000002','ch-2','call-0',null,'model',null,'"anthropic/claude-sonnet-5-5"','Faster on big numbers.');
select public.agent_propose_change('ef000000-0000-0000-0000-000000000001','ch-1','call-0','Ads','instructions',null,'"You write short ad copy."','Its copy runs long.');
select public.agent_propose_change('ef000000-0000-0000-0000-000000000001','ch-1','call-1',null,'setting','terminal.backend','"local"','I need a shell.');
reset role;

-- What Settings reads, per reader: each waiting proposal's Agent, what, and who proposed it.
create temporary table seen(n int, agent text, change text, by text);
grant insert on seen to authenticated;
set local role authenticated;
do $$ begin
 for n in 1..4 loop
  perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-00000000000'||n,true);
  insert into seen select n,g.name,p.change,b.name from public.agent_change_proposals p
   join public.hermes_agents g on g.id=p.agent_id left join public.hermes_agents b on b.id=p.proposed_by
   where p.company_id='10000000-0000-0000-0000-000000000001' and p.state in ('waiting','applying');
 end loop;
end $$;
reset role;
select results_eq('select n,agent,change,by from seen order by n,change',
 $$values (1,'Ads','instructions','Lead'),(1,'Ads','model','Ads'),(2,'Ads','model','Ads')$$,
 'the Owner reads both waiting proposals with who proposed them; the Manager reads the one from their own chat; the Contributor, who sees Ads but not that chat, and the Viewer read none');

-- An approval being written still waits, for its Owner and its asker.
update public.agent_change_proposals set state='applying',claimed_by='20000000-0000-0000-0000-000000000001',claimed_at=now(),claim_token=gen_random_uuid()
 where run_id='ch-2' and call_id='call-0';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.agent_change_proposals where state in ('waiting','applying')),1,'a proposal whose approval is being written still waits for its asker');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.agent_change_proposals where company_id='10000000-0000-0000-0000-000000000001' and state in ('waiting','applying')),2,
 'and the Owner''s number on Agents counts it');
reset role;

-- The Manager stops seeing Ads: their proposal is gone from their Settings, and stays the Owner's.
delete from public.member_agent_access where person_id='20000000-0000-0000-0000-000000000002' and agent_id='ee000000-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.agent_change_proposals),0,'a Member who no longer sees the Agent reads no proposal for it');
reset role;

-- Answered, a proposal waits no more for anyone.
update public.agent_change_proposals set state='declined',answered_by='20000000-0000-0000-0000-000000000001',answered_at=now(),answer='Not now.',claimed_by=null,claimed_at=null,claim_token=null
 where run_id='ch-2' and call_id='call-0';
update public.agent_change_proposals set state='approved',answered_by='20000000-0000-0000-0000-000000000001',answered_at=now()
 where run_id='ch-1' and call_id='call-0';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.agent_change_proposals where state in ('waiting','applying')),0,'once answered, nothing waits for the Owner');
reset role;

-- Another Company's Owner reads none of them.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000099',true);
select is((select count(*)::int from public.agent_change_proposals),0,'nobody outside the Company reads a proposal');
reset role;
select * from finish();
rollback;
