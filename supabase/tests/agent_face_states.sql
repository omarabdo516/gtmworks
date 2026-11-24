begin;
create extension if not exists pgtap with schema extensions;
select plan(29);
-- The one state read of #699 (spec #694): for the reader, every Agent they see is waiting, working, stuck, asleep or idle.
-- RS Learning's Agents, each set up for one case. The Contributor (…03) and the Viewer (…04) are shown Ads, Reach,
-- Writer and Critic; SEO is hidden from them. Aleem's Lead is another Company's.
--  Lead   main, made a month ago, no work since: asleep
--  Ads    a Run open in the Owner's private Conversation: working, to every reader who sees it, and nothing more
--  SEO    a Run open in the general channel, hidden from the Contributor and the Viewer
--  Reach  a Card of it waits on the Owner, and a note Run of it is open on that Card
--  Hook   a question waits on the Owner in their Conversation with it; a Routine of it ended two days ago
--  Writer its last Run failed in a team channel the Owner is in and the Contributor is not
--  Coder  the Owner stopped its last Run; its turn waits behind SEO's
--  Numbers its last Run failed in the general channel and a person wrote there after it
--  Critic  its Run failed in the Owner's Conversation, then it worked in the general channel
--  Old    its Run failed a day and a half ago
--  New    made today, no work at all
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,created_at)
 select ('a6990000-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid,'10000000-0000-0000-0000-000000000001',
  ('f6990000-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid,name,name,n=1,'default',
  case when name='New' then now()-interval '1 hour' else now()-interval '30 days' end
 from unnest(array['Lead','Ads','SEO','Reach','Hook','Writer','Coder','Numbers','Critic','Old','New']) with ordinality x(name,n);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6990000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000003','f6990000-0000-0000-0000-000000000099','Lead','General',true,'default');
create temp table named(name text primary key, agent uuid) on commit drop;
insert into named select name,id from public.hermes_agents where id::text like 'a6990000-%' and company_id='10000000-0000-0000-0000-000000000001';
grant select on named to authenticated;
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',p,agent from named
 cross join unnest(array['20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[]) p
 where name in ('Ads','Reach','Writer','Critic');
insert into public.channels(id,company_id,kind,name,created_by,create_key) values
 ('c6990000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','team','Launch','20000000-0000-0000-0000-000000000001',gen_random_uuid());
insert into public.channel_people(channel_id,company_id,person_id) values
 ('c6990000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
 select ('b6990000-0000-0000-0000-0000000000'||lpad(row_number() over (order by name)::text,2,'0'))::uuid,'10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',agent,name from named where name in ('Ads','Hook','Coder','Critic','Old');
create temp table chat(name text primary key, id uuid) on commit drop;
insert into chat select agent_name,id from public.conversations where id::text like 'b6990000-%';
grant select on chat to authenticated;

-- Reach's Card.
insert into public.work_cards(id,company_id,stage_id,title,agent_id) overriding system value
 select -6991,'10000000-0000-0000-0000-000000000001',(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' order by position limit 1),'Reach card',agent
 from named where name='Reach';

set local session_replication_role=replica;
-- A person's message that starts a Run, in a chat, at a time.
create function pg_temp.ask(who text, run text, at timestamptz) returns void language sql as $$
 insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at)
  select '10000000-0000-0000-0000-000000000001',id,'person','20000000-0000-0000-0000-000000000001','عمر','Go',gen_random_uuid(),run,at from chat where name=who;
$$;
create function pg_temp.ended(who text, run text, how text, at timestamptz) returns void language sql as $$
 insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome,recorded_at)
  select '10000000-0000-0000-0000-000000000001',id,run,how,at from chat where name=who;
$$;
-- A channel message calling an Agent, and its Run, ended as told (or open).
create function pg_temp.called(id bigint, ch uuid, who text, how text, at timestamptz) returns void language sql as $$
 insert into public.channel_messages(id,company_id,channel_id,author,person_id,author_name,body,send_key,created_at) overriding system value values
  (id,'10000000-0000-0000-0000-000000000001',ch,'person','20000000-0000-0000-0000-000000000001','عمر','@'||who,gen_random_uuid(),at);
 insert into public.channel_runs(message_id,company_id,channel_id,agent_id,agent_name,session,input,created_at,outcome,closed_at)
  select id,'10000000-0000-0000-0000-000000000001',ch,agent,who,gen_random_uuid(),'go',at,how,case when how is not null then at+interval '1 minute' end from named where name=who;
$$;
select pg_temp.ask('Ads','ads-1',now()-interval '2 minutes');
select pg_temp.called(-6991,'69000000-0000-0000-0000-000000000001','SEO',null,now()-interval '1 minute');
-- The same message called Coder after SEO: its turn waits for SEO's (#152), so Coder is not working yet.
insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,created_at)
 select -6991,2,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001',agent,'Coder',gen_random_uuid(),'go',now()-interval '1 minute' from named where name='Coder';
-- A question on Reach's Card waits on the Owner, and a note Run is open on that Card.
insert into public.waiting_items(company_id,person_id,kind,title,card_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','question','Which audience?',-6991);
insert into public.work_comments(id,company_id,card_id,body,author_id,created_at) overriding system value values
 (-6991,'10000000-0000-0000-0000-000000000001',-6991,'@Reach go','20000000-0000-0000-0000-000000000001',now()-interval '3 minutes');
insert into public.note_runs(note_id,company_id,card_id,agent_id,agent_name,session,input,created_at)
 select -6991,'10000000-0000-0000-0000-000000000001',-6991,agent,'Reach',gen_random_uuid(),'go',now()-interval '3 minutes' from named where name='Reach';
-- Hook's question in the Owner's own Conversation, and its Routine's last result.
insert into public.waiting_items(company_id,person_id,kind,title,conversation_id)
 select '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','question','Which day?',id from chat where name='Hook';
insert into public.routine_results(company_id,agent_id,profile,routine_id,session_id,ended_at)
 select '10000000-0000-0000-0000-000000000001',agent,'ag-'||md5('hook'),'abcdef','s-hook',now()-interval '2 days' from named where name='Hook';
select pg_temp.called(-6992,'c6990000-0000-0000-0000-000000000001','Writer','failed',now()-interval '2 hours');
select pg_temp.ask('Coder','coder-1',now()-interval '2 hours');
select pg_temp.ended('Coder','coder-1','stopped',now()-interval '119 minutes');
select pg_temp.called(-6993,'69000000-0000-0000-0000-000000000001','Numbers','failed',now()-interval '2 hours');
insert into public.channel_messages(id,company_id,channel_id,author,person_id,author_name,body,send_key,created_at) overriding system value values
 (-6994,'10000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000002','مدير','Never mind',gen_random_uuid(),now()-interval '1 hour');
select pg_temp.ask('Critic','critic-1',now()-interval '3 hours');
select pg_temp.ended('Critic','critic-1','failed',now()-interval '179 minutes');
select pg_temp.called(-6995,'69000000-0000-0000-0000-000000000001','Critic','completed',now()-interval '1 hour');
select pg_temp.ask('Old','old-1',now()-interval '36 hours');
select pg_temp.ended('Old','old-1','failed',now()-interval '36 hours');
set local session_replication_role=origin;

create function pg_temp.states() returns table(name text, state text) language sql as $$
 select n.name,s.state from public.agent_face_states('10000000-0000-0000-0000-000000000001') s join named n on n.agent=s.agent order by n.name;
$$;
grant execute on function pg_temp.states() to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select results_eq($$select * from pg_temp.states()$$,
 $$values ('Ads','working'),('Coder','idle'),('Critic','idle'),('Hook','waiting'),('Lead','asleep'),('New','idle'),('Numbers','idle'),('Old','idle'),
  ('Reach','waiting'),('SEO','working'),('Writer','stuck')$$,
 'the Owner reads each Agent''s one state: waiting before working, a stopped Run and a followed failure are no failure, a failure ends after a day, a new Agent never sleeps');
select results_eq($$select failed_channel,failed_conversation,failed_card from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='Writer')$$,
 $$values ('c6990000-0000-0000-0000-000000000001'::uuid,null::uuid,null::bigint)$$,'a stuck Agent names where it failed, so opening there can clear it');
select is((select working from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='Reach')),true,
 'an Agent that waits on its reader is working too, under the one state');
select ok((select last_work_at > now()-interval '3 days' from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='Hook')),
 'a Routine''s run is work, so Hook is awake');
select ok((select last_work_at is null and created_at < now()-interval '7 days' from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='Lead')),
 'Lead has done nothing since it was made a month ago');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select * from pg_temp.states()$$,
 $$values ('Ads','working'),('Critic','idle'),('Lead','asleep'),('Reach','working'),('Writer','idle')$$,
 'the Contributor reads the Agents shown to them: busy in the Owner''s Conversation and on the Card, nothing of the Owner''s waiting, no failure in a channel they are not in');
select results_eq($$select waiting,failed_at,failed_conversation,failed_channel,failed_card from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='Ads')$$,
 $$values (false,null::timestamptz,null::uuid,null::uuid,null::bigint)$$,'of the Owner''s private Conversation the Contributor learns only that Ads is busy');
select is_empty($$select 1 from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='SEO')$$,
 'nothing about SEO, hidden from the Contributor, though it works in the general channel');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select results_eq($$select * from pg_temp.states()$$,
 $$values ('Ads','working'),('Critic','idle'),('Lead','asleep'),('Reach','working'),('Writer','idle')$$,
 'the Viewer reads the Agents shown to them, and nothing waits on a Viewer');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is_empty($$select * from public.agent_face_states('10000000-0000-0000-0000-000000000003')$$,'a person outside Aleem learns nothing of its Agents');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select results_eq($$select agent,state from public.agent_face_states('10000000-0000-0000-0000-000000000003')$$,
 $$values ('a6990000-0000-0000-0000-000000000099'::uuid,'idle')$$,'a member of Aleem reads its Lead');
select set_config('request.jwt.claim.sub','',true);
select is_empty($$select * from public.agent_face_states('10000000-0000-0000-0000-000000000001')$$,'nor does a caller with no session');
select is(public.wake_agent('10000000-0000-0000-0000-000000000001',(select agent from named where name='Lead')),false,'nor wakes an Agent');

-- Opening where it failed clears the failure for that reader only, and opening an Agent's chat wakes it for that reader.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(public.see_agent_failure('10000000-0000-0000-0000-000000000001',channel=>'c6990000-0000-0000-0000-000000000001'),0,
 'a Contributor outside the team channel has no failure there to clear');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.see_agent_failure('10000000-0000-0000-0000-000000000001',channel=>'69000000-0000-0000-0000-000000000001'),0,
 'opening the general channel clears nothing: Writer failed elsewhere');
select is(public.see_agent_failure('10000000-0000-0000-0000-000000000001',channel=>'c6990000-0000-0000-0000-000000000001'),1,
 'the Owner opens the team channel where Writer failed');
select is((select state from pg_temp.states() where name='Writer'),'idle','and Writer is no longer stuck for them');
select is(public.wake_agent('10000000-0000-0000-0000-000000000001',(select agent from named where name='Lead')),true,'the Owner opens Lead''s chat');
select is((select state from pg_temp.states() where name='Lead'),'idle','and Lead is awake for them');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is((select state from pg_temp.states() where name='Lead'),'asleep','and still asleep for the Contributor');
select is(public.wake_agent('10000000-0000-0000-0000-000000000001',(select agent from named where name='SEO')),false,'an Agent hidden from the reader is not woken');

-- A failure the reader has seen comes back when the Agent fails again; new work clears a failure for everyone. The
-- whole test is one transaction, so the Owner's opening is put back an hour before Writer fails again.
reset role;
update public.agent_reader_marks set failure_seen_at=now()-interval '1 hour' where person_id='20000000-0000-0000-0000-000000000001';
select pg_temp.called(-6996,'c6990000-0000-0000-0000-000000000001','Writer','failed',now()-interval '5 minutes');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select state from pg_temp.states() where name='Writer'),'stuck','a new failure where the Owner had opened shows again');
reset role;
select pg_temp.called(-6997,'69000000-0000-0000-0000-000000000001','Writer','completed',now());
set local role authenticated;
select is((select state from pg_temp.states() where name='Writer'),'idle','new work after a failure clears it');

-- A Handover's leg to an Agent is its work, though the Conversation is Lead's.
reset role;
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,state,target_run,target_attempts)
 select '10000000-0000-0000-0000-000000000001',c.id,'old-1','call-new',(select agent from named where name='Lead'),n.agent,'Write it','target','run-new',1
 from chat c, named n where c.name='Old' and n.name='New';
set local role authenticated;
select is((select state from pg_temp.states() where name='New'),'working','an Agent handed work by Lead is working');

-- A Routine running on the Engine is the Agent's work while the worker keeps seeing it (routine_runs_open, refreshed on
-- each of its passes): working to every reader who sees the Agent, and nothing more of it. A record the worker stopped
-- refreshing (it crashed, or its Engine went away) holds for two minutes, then the Agent is no longer working.
reset role;
insert into public.routine_runs_open(company_id,agent_id,profile,routine_id,started_at,seen_at)
 select '10000000-0000-0000-0000-000000000001',agent,'ag-'||md5('critic'),'abc123',now()-interval '5 minutes',now()-interval '10 seconds'
 from named where name='Critic';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select state from pg_temp.states() where name='Critic'),'working','an Agent running a Routine is working');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select results_eq($$select state,waiting,failed_at from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='Critic')$$,
 $$values ('working',false,null::timestamptz)$$,'to the Contributor too, and nothing more of the Routine');
reset role;
update public.routine_runs_open set seen_at=now()-interval '3 minutes' where routine_id='abc123' and profile='ag-'||md5('critic');
set local role authenticated;
select is((select state from pg_temp.states() where name='Critic'),'idle','a Routine the worker no longer sees running leaves the Agent working no more');
select ok((select last_work_at >= now()-interval '5 minutes' from public.agent_face_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='Critic')),
 'and its start is the Agent''s newest work');

-- The previous release's read still answers on this schema, in its own shape.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select results_eq($$select running,waiting_mine from public.agent_states('10000000-0000-0000-0000-000000000001') where agent=(select agent from named where name='Reach')$$,
 $$values (false,true)$$,'the previous release''s agent_states keeps its columns and meaning');
select * from finish();
rollback;
