begin;
create extension if not exists pgtap with schema extensions;
select plan(50);
-- #122. RS Learning (1): Lead on the Company's own profile, ready but for its shared folder, and the Writer Lead made on
-- its own profile. Aleem (3) has its own profile too. The Writer is shown to the Manager (2), the Contributor (3) and
-- the Viewer (4).
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('c5000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','co-10000000000000000000000000000001','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values ('c5000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000001','Lead','General',true);
insert into public.hermes_agent_audit(company_id,actor_id,agent_id,action,details) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000002','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','c5000000-0000-0000-0000-000000000001'));
insert into public.company_profiles(company_id,profile,tools_level,tools_policy) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy()),
 ('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000003',1,public.engine_tool_policy());
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c5100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000002','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c5100000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','I want someone to write our blog',gen_random_uuid(),'run-1');
create temporary table named(name text primary key, agent uuid, profile text, connection uuid);
grant select on named to authenticated;
grant all on named to service_role;
set local role service_role;
insert into named(name,agent) select 'writer',(public.lead_create_agent(conversation=>'c5100000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-0',agent_name=>'Writer',job=>'Writes the blog.',apps=>'{}',
 own_level=>1,own_policy=>2)->>'agent')::uuid;
reset role;
insert into named values ('lead','c5000000-0000-0000-0000-000000000002');
update named n set profile=h.profile,connection=h.id from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=n.agent;
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',('20000000-0000-0000-0000-00000000000'||n)::uuid,agent from named,generate_series(2,4) n where name='writer';
select is((select profile from named where name='writer'),public.agent_engine_profile((select agent from named where name='writer')),'the Writer runs on its own profile');

-- No Connection names a shared space, and no Agent sits on one; a Run is refused on one found from before.
select throws_ok($$insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','cs-10000000000000000000000000000001','ciphertext','connected')$$,
 '42501','hermesProfileNotShared','a Connection naming the Company''s own shared space is refused');
set local session_replication_role=replica;
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('c5000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','cs-10000000000000000000000000000001','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('c5000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000009','Stray','Stray');
set local session_replication_role=origin;
select throws_ok($$insert into public.hermes_agents(company_id,connection_id,name,speciality) values ('10000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000009','Other','Other')$$,
 '42501','hermesProfileNotShared','an Agent on a Connection naming a shared space is refused');
select throws_ok($$update public.hermes_agents set connection_id='c5000000-0000-0000-0000-000000000009' where id='c5000000-0000-0000-0000-000000000002'$$,
 '42501','hermesProfileNotShared','and so is moving one onto it');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.reserve_conversation_run('c5200000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000008','c5300000-0000-0000-0000-000000000009','Hello')$$,
 '42501','hermesProfileNotShared','a Run on a shared space is refused');
reset role;

-- Until a worker of this version lists its work, the previous version's Runs and moves go on as before.
delete from public.shared_skills_worker;
select ok(public.company_profile_ready('10000000-0000-0000-0000-000000000001'),'with no worker that confirms shared folders, the Company''s profile is ready as before');
select is(public.agent_profile_refusal((select profile from named where name='writer'),'10000000-0000-0000-0000-000000000001',(select agent from named where name='writer')),null,'and so is an Agent''s own profile');

-- The worker's list and the readiness of each profile until its shared folder is confirmed.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select results_eq($$select company_id,profile,folder,lessons,profiles from public.shared_skills_work() order by company_id$$,
 $$values ('10000000-0000-0000-0000-000000000001'::uuid,'cs-10000000000000000000000000000001',null::text,'[]'::jsonb,
   jsonb_build_array(jsonb_build_object('profile',(select profile from named where name='writer')),jsonb_build_object('profile','co-10000000000000000000000000000001'))),
  ('10000000-0000-0000-0000-000000000003'::uuid,'cs-10000000000000000000000000000003',null::text,'[]'::jsonb,jsonb_build_array(jsonb_build_object('profile','co-10000000000000000000000000000003')))$$,
 'each Company with a recorded profile is listed with its space, no folder yet, and every profile to confirm');
select is(public.record_shared_skills('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001'),false,'no profile is confirmed before its Company''s space is recorded');
reset role;
create function pg_temp.reserved(agent text, conversation text, message_key text) returns text language plpgsql as $$
begin
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
 set local role authenticated;
 perform public.reserve_conversation_run(conversation::uuid,'10000000-0000-0000-0000-000000000001',(select n.agent from named n where n.name=reserved.agent),message_key::uuid,'Hello');
 reset role;
 return 'reserved';
exception when others then reset role; return sqlerrm;
end $$;
select is(pg_temp.reserved('lead','c5200000-0000-0000-0000-000000000001','c5300000-0000-0000-0000-000000000001'),'agentLevelPending','no Run starts on the Company''s profile before its shared folder is confirmed');
select is(pg_temp.reserved('writer','c5200000-0000-0000-0000-000000000002','c5300000-0000-0000-0000-000000000002'),'agentLevelPending','nor on an Agent''s own profile');
select ok(not public.company_profile_ready('10000000-0000-0000-0000-000000000001'),'the Company''s profile is not ready');
update public.shared_skills_worker set seen_at=now()-interval '11 minutes';
select ok(public.company_profile_ready('10000000-0000-0000-0000-000000000001'),'once that worker has not listed its work for ten minutes, the wait lapses');
update public.shared_skills_worker set seen_at=now();
select ok(not public.company_profile_ready('10000000-0000-0000-0000-000000000001'),'and it holds again when the worker lists its work');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.record_shared_space('10000000-0000-0000-0000-000000000001','/opt/data/profiles/cs-10000000000000000000000000000003/skills')$$,
 '22023','sharedSpaceInvalid','a folder of another Company''s space is refused');
select throws_ok($$select public.record_shared_space('10000000-0000-0000-0000-000000000001','/opt/data/profiles/cs-10000000000000000000000000000001')$$,
 '22023','sharedSpaceInvalid','and so is a folder that is not the space''s Skills');
select is(public.record_shared_space('10000000-0000-0000-0000-000000000001','/opt/data/profiles/cs-10000000000000000000000000000001/skills'),
 '/opt/data/profiles/cs-10000000000000000000000000000001/skills','the space is recorded with its Skills folder');
select is(public.record_shared_space('10000000-0000-0000-0000-000000000001','/srv/hermes/profiles/cs-10000000000000000000000000000001/skills'),
 '/opt/data/profiles/cs-10000000000000000000000000000001/skills','a second worker''s record answers the folder recorded first');
reset role;
select is((select count(*)::int from public.company_shared_spaces),1,'one space');
set local role service_role;
select is((select folder from public.shared_skills_work() where company_id='10000000-0000-0000-0000-000000000001'),'/opt/data/profiles/cs-10000000000000000000000000000001/skills','and the worker reads its folder');
select is(public.record_shared_skills('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000003'),false,'another Company''s profile is never confirmed with this Company''s folder');
select is(public.record_shared_skills('10000000-0000-0000-0000-000000000003','co-10000000000000000000000000000001'),false,'nor this Company''s with another''s');
select is(public.record_shared_skills('10000000-0000-0000-0000-000000000001','default'),false,'nor a profile that is not the Company''s');
select ok(public.record_shared_skills('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001'),'the Company''s own profile is confirmed');
reset role;
select is((select string_agg(company_id::text||'='||skills_shared::text,',' order by company_id) from public.company_profiles),
 '10000000-0000-0000-0000-000000000001=true,10000000-0000-0000-0000-000000000003=false','only it');
select is(pg_temp.reserved('lead','c5200000-0000-0000-0000-000000000001','c5300000-0000-0000-0000-000000000001'),'reserved','a Run on the Company''s profile is reserved once confirmed');
select is(pg_temp.reserved('writer','c5200000-0000-0000-0000-000000000002','c5300000-0000-0000-0000-000000000002'),'agentLevelPending','the Writer''s profile still waits');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select ok(public.record_shared_skills('10000000-0000-0000-0000-000000000001',(select profile from named where name='writer')),'the Writer''s profile is confirmed');
select is((select profiles from public.shared_skills_work() where company_id='10000000-0000-0000-0000-000000000001'),'[]'::jsonb,'and nothing is left to confirm');
reset role;
select is(pg_temp.reserved('writer','c5200000-0000-0000-0000-000000000002','c5300000-0000-0000-0000-000000000002'),'reserved','a Run on the Writer''s profile is reserved once confirmed');

-- A profile the Engine lost is confirmed again once made again; a space the Engine lost holds every profile of its Company.
set local role service_role;
select ok(public.forget_company_profile((select connection from named where name='writer')),'tool health forgets the Writer''s lost profile');
reset role;
select is((select skills_shared from public.agent_profiles where agent_id=(select agent from named where name='writer')),false,'and its shared folder is no longer confirmed');
update public.agent_profiles set tools_level=1,tools_policy=public.engine_tool_policy(),skills_shared=true where agent_id=(select agent from named where name='writer');
set local role service_role;
select lives_ok($$select public.forget_shared_space('10000000-0000-0000-0000-000000000001')$$,'the worker forgets a space the Engine lost');
reset role;
select ok(not exists(select 1 from public.company_shared_spaces) and not exists(select 1 from public.company_profiles where skills_shared) and not exists(select 1 from public.agent_profiles where skills_shared),
 'its record goes, and no profile of the Company is confirmed');
select is(pg_temp.reserved('lead','c5200000-0000-0000-0000-000000000003','c5300000-0000-0000-0000-000000000003'),'agentLevelPending','so no Run starts on them');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.record_shared_skills('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001'),false,'until the space is made and recorded again');
reset role;

-- Lessons: only what an Owner or a Manager approved, in the order it was said, until it is removed. The Contributor
-- suggests three; the Owner tells one directly.
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) select x.id::uuid,'10000000-0000-0000-0000-000000000001',x.person::uuid,agent,'Writer' from named,
 (values ('c5400000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003'),('c5400000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001')) x(id,person) where name='writer';
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
 select '10000000-0000-0000-0000-000000000001',x.conversation::uuid,'person',x.person::uuid,'Someone',x.body,gen_random_uuid(),x.run from (values
  ('c5400000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','l-a','From now on, write   every
 Saudi ad in a light dialect'),
  ('c5400000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','l-b','From now on, no emojis'),
  ('c5400000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','l-c','From now on, answer within the hour'),
  ('c5400000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','l-d','From now on, send nothing before I see it')) x(conversation,person,run,body);
create temporary table told as select conversation_id,run_id,body from public.conversation_messages where conversation_id in ('c5400000-0000-0000-0000-000000000001','c5400000-0000-0000-0000-000000000003');
grant select on told to service_role;
set local role service_role;
select results_eq($$select run_id,public.agent_save_rule(conversation_id,run_id,'call-0',body)->>'state' from told order by run_id$$,
 $$values ('l-a','suggested'),('l-b','suggested'),('l-c','suggested'),('l-d','saved')$$,'three suggestions wait and the Owner''s rule is the team''s at once');
reset role;
update public.agent_rules set said_at=now()-interval '1 hour'+(ascii(right(run_id,1))-ascii('a'))*interval '1 minute';
create function pg_temp.lessons() returns jsonb language sql as $$ select lessons from public.shared_skills_work() where company_id='10000000-0000-0000-0000-000000000001' $$;
select is(pg_temp.lessons(),'[]'::jsonb,'a waiting suggestion and a rule told directly are no lessons');
-- A Contributor and a Viewer holding an item for a suggestion still cannot decide it.
insert into public.waiting_items(company_id,person_id,kind,title,body,asked_by,agent_rule_id)
 select company_id,p,'rule_suggestion',body,'Writer','مراجع',id from public.agent_rules,unnest(array['20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[]) p where run_id='l-a';
create function pg_temp.decided(person text, run text, approve boolean) returns text language plpgsql as $$
declare item bigint:=(select i.id from public.waiting_items i join public.agent_rules r on r.id=i.agent_rule_id where r.run_id=decided.run and i.person_id=person::uuid);
begin
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 perform set_config('request.jwt.claim.sub',person,true);
 set local role authenticated;
 perform public.decide_agent_rule('10000000-0000-0000-0000-000000000001',item,approve);
 reset role;
 return (select suggestion from public.agent_rules where run_id=decided.run);
exception when others then reset role; return sqlerrm;
end $$;
select is(pg_temp.decided('20000000-0000-0000-0000-000000000003','l-a',true),'agentRuleNotAllowed','a Contributor cannot approve');
select is(pg_temp.decided('20000000-0000-0000-0000-000000000004','l-a',true),'agentRuleNotAllowed','nor a Viewer');
select is(pg_temp.decided('20000000-0000-0000-0000-000000000003','l-a',false),'agentRuleNotAllowed','nor refuse');
select is(pg_temp.lessons(),'[]'::jsonb,'so nothing is written for the team');
select is(pg_temp.decided('20000000-0000-0000-0000-000000000002','l-b',true),'approved','the Manager approves one');
select is(pg_temp.decided('20000000-0000-0000-0000-000000000001','l-a',true),'approved','and the Owner another');
select is(pg_temp.decided('20000000-0000-0000-0000-000000000002','l-c',false),'rejected','the Manager refuses the third');
select is(pg_temp.lessons(),'["From now on, write   every\n Saudi ad in a light dialect","From now on, no emojis"]'::jsonb,'each approved one is a lesson, oldest first; the refused one never is');
select lives_ok($$select pg_temp.decided('20000000-0000-0000-0000-000000000001','l-a',true)$$,'deciding again changes nothing');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select ok(public.remove_agent_rule('10000000-0000-0000-0000-000000000001',(select id from public.agent_rules where run_id='l-a')),'the Owner removes the oldest');
reset role;
select is(pg_temp.lessons(),'["From now on, no emojis"]'::jsonb,'and it is no lesson any more');
select is((select lessons from public.shared_skills_work() where company_id='10000000-0000-0000-0000-000000000003'),'[]'::jsonb,'another Company has none of them');
select * from finish();
rollback;
