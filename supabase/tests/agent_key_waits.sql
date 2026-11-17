begin;
create extension if not exists pgtap with schema extensions;
select plan(27);
-- #299. RS Learning (1): Lead on the Company's own profile, and the Owner's (Omar's) Conversation with Lead. R&S
-- Consultations (2), where Omar is Owner too, has its own Lead. The Manager (2) is a member of RS Learning only, and
-- an Outsider of neither.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('e2990000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','co-10000000000000000000000000000001','ciphertext','connected','0.23.0','{run_submission}'),
 ('e2990000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','co-10000000000000000000000000000002','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('e2990000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-000000000001','Lead','General',true),
 ('e2990000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000002','e2990000-0000-0000-0000-000000000002','Lead two','General',true);
insert into public.hermes_agent_audit(company_id,actor_id,agent_id,action,details) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-000000000011','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','e2990000-0000-0000-0000-000000000001')),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-000000000012','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','e2990000-0000-0000-0000-000000000002'));
insert into public.company_profiles(company_id,profile,tools_level,tools_policy,skills_shared) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy(),true),
 ('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1,public.engine_tool_policy(),true);
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e2991000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-000000000011','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','e2991000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','I want someone to write our blog',gen_random_uuid(),'run-1');
insert into auth.users(id,email) values ('e2990000-0000-0000-0000-000000000099','outsider-299@example.com');
insert into public.people(id,name) values ('e2990000-0000-0000-0000-000000000099','Outsider');
create temporary table made(name text primary key, agent uuid, profile text, connection uuid);
insert into made(name,agent) values ('waiting',public.lead_agent_id('e2991000-0000-0000-0000-000000000001','run-1','call-0')),('lead',public.lead_agent_id('e2991000-0000-0000-0000-000000000001','run-1','call-1'));
update made set profile=public.agent_engine_profile(agent);
grant select on made to authenticated,service_role;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',true)$$,'the Owner sets the Company''s key');
reset role;
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000001'),true,'the Company holds a key');
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000002'),false,'the other Company holds none');

set local role service_role;
select is(public.lead_create_agent(conversation=>'e2991000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-0',agent_name=>'Writer',job=>'Writes the blog.',apps=>'{WordPress}',
  instructions=>'You write for {company}.',own_level=>1,own_policy=>public.engine_tool_policy(),own_answers=>false),jsonb_build_object('state','created','agent',(select agent from made where name='waiting')),
 'an Agent whose own profile has no model yet is made');
reset role;
update made set connection=(select connection_id from public.hermes_agents where id=made.agent) where name='waiting';
select is((select h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=(select agent from made where name='waiting')),
 (select profile from made where name='waiting'),'it is attached to its own profile, never Lead''s');
select is((select count(*)::int from public.agent_key_waits where agent_id=(select agent from made where name='waiting') and company_id='10000000-0000-0000-0000-000000000001'),1,'and waits for the key');
select is(public.agent_profile_refusal((select profile from made where name='waiting'),'10000000-0000-0000-0000-000000000001',(select agent from made where name='waiting')),'agentLevelPending',
 'every Run entry holds it');

set local role authenticated;
select throws_ok($$select public.reserve_conversation_run('e2992000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from made where name='waiting'),'e2993000-0000-0000-0000-000000000001','Hello')$$,
 '55000','agentLevelPending','no Run is reserved for it');
select results_eq($$select kind,title,body,asked_by,card_id,conversation_id from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='agent_key'$$,
 $$values ('agent_key'::text,'Writer'::text,''::text,''::text,null::bigint,null::uuid)$$,'the Owner sees it waiting, by its name');
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000002') where kind='agent_key'),0,'and nothing waits in the other Company');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='agent_key'),0,'a Manager does not see it');
select is((select count(*)::int from public.agent_key_waits),0,'nor reads the waits');
select throws_ok($$select public.end_agent_key_waits('10000000-0000-0000-0000-000000000001',array[(select profile from made where name='waiting')])$$,'42501','keyNotAllowed','a Manager cannot end the wait');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.end_agent_key_waits('10000000-0000-0000-0000-000000000002',array[(select profile from made where name='waiting')])$$,'the Owner ends the waits of the other Company');
reset role;
select is((select count(*)::int from public.agent_key_waits),1,'which leaves this Company''s wait');
set local role authenticated;
select lives_ok($$select public.end_agent_key_waits('10000000-0000-0000-0000-000000000001',array[(select profile from made where name='waiting')])$$,'a set that gave its profile key and model ends it');
reset role;
select is(public.agent_profile_refusal((select profile from made where name='waiting'),'10000000-0000-0000-0000-000000000001',(select agent from made where name='waiting')),null,'then nothing holds its Runs');
set local role authenticated;
select is(public.reserve_conversation_run('e2992000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from made where name='waiting'),'e2993000-0000-0000-0000-000000000002','Hello'),
 (select connection from made where name='waiting'),'and a Run is reserved on its own profile');
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='agent_key'),0,'and it leaves "Waiting on you"');

select lives_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',false)$$,'the Owner removes the key');
reset role;
set local role service_role;
select is(public.lead_create_agent(conversation=>'e2991000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-1',agent_name=>'SEO',job=>'Writes for search.',apps=>'{}',
  own_level=>1,own_policy=>public.engine_tool_policy(),own_answers=>false)->>'agent',(select agent::text from made where name='lead'),'with no key held, the same call makes the Agent');
reset role;
select ok((select h.profile='co-10000000000000000000000000000001' and not exists(select 1 from public.agent_profiles p where p.agent_id=a.id) and not exists(select 1 from public.agent_key_waits w where w.agent_id=a.id)
  from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=(select agent from made where name='lead')),
 'on Lead''s profile as before, with no profile of its own and no wait');

set local role authenticated;
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','remove',null,(select agent from made where name='waiting'))$$,'the Owner removes the Agent with its own profile');
select results_eq($$select profile,kind,agent,name from public.company_key_profiles('10000000-0000-0000-0000-000000000001') where kind='removed'$$,
 $$select profile,'removed'::text,agent,'Writer'::text from made where name='waiting'$$,'its profile is still listed, as removed, for the next key removal');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.company_key_profiles('10000000-0000-0000-0000-000000000001') where kind='removed'),1,'a member reads it too');
select set_config('request.jwt.claim.sub','e2990000-0000-0000-0000-000000000099',true);
select is((select count(*)::int from public.company_key_profiles('10000000-0000-0000-0000-000000000001')),0,'a person outside the Company does not');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.company_key_profiles('10000000-0000-0000-0000-000000000002') where kind='removed'),0,'and the other Company lists none of it');
reset role;
select * from finish();
rollback;
