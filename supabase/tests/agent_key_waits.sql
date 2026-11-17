begin;
create extension if not exists pgtap with schema extensions;
select plan(72);
-- #299. Nothing in this transaction takes lead_create_agent's lock before the first key change begins.
create temporary view held_agent_lock as select exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted
 and ((classid::bigint<<32)|objid::bigint)=hashtextextended('hermes_agents',0)) as held;
select is((select held from held_agent_lock),false,'the lock is not held before a key change begins');
set local role service_role;
select lives_ok($$select public.begin_provider_key_change('10000000-0000-0000-0000-000000000002','openrouter')$$,'the server begins a change of a Company''s key');
reset role;
select is((select held from held_agent_lock),true,'beginning took the lock lead_create_agent takes, to the end of its transaction');
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000002'),true,'while the change is under way, the Company counts as holding a key');
set local role service_role;
select is(public.finish_provider_key_change('10000000-0000-0000-0000-000000000002','openrouter',null,'{}'),'{}'::text[],'the Engine refused it, so it finishes as it was');
reset role;
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000002'),false,'which was holding none');

-- RS Learning (1): Lead on the Company's own profile, the Owner's (Omar's) Conversation with Lead and the Manager's.
-- R&S Consultations (2), where Omar is Owner too, has its own Lead. The Manager (2) is a member of RS Learning only, and
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
 ('e2991000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-000000000011','Lead'),
 ('e2991000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','e2990000-0000-0000-0000-000000000011','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','e2991000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','I want someone to write our blog',gen_random_uuid(),'run-1'),
 ('10000000-0000-0000-0000-000000000001','e2991000-0000-0000-0000-000000000002','person','20000000-0000-0000-0000-000000000002','Manager','I want someone for our social posts',gen_random_uuid(),'run-2');
insert into auth.users(id,email) values ('e2990000-0000-0000-0000-000000000099','outsider-299@example.com');
insert into public.people(id,name) values ('e2990000-0000-0000-0000-000000000099','Outsider');
create temporary table made(name text primary key, agent uuid, profile text, connection uuid);
insert into made(name,agent) values ('waiting',public.lead_agent_id('e2991000-0000-0000-0000-000000000001','run-1','call-0')),('lead',public.lead_agent_id('e2991000-0000-0000-0000-000000000001','run-1','call-1')),
 ('bare',public.lead_agent_id('e2991000-0000-0000-0000-000000000001','run-1','call-2')),('asked',public.lead_agent_id('e2991000-0000-0000-0000-000000000002','run-2','call-0')),
 ('plain',public.lead_agent_id('e2991000-0000-0000-0000-000000000001','run-1','call-3'));
update made set profile=public.agent_engine_profile(agent);
grant select on made to authenticated,service_role;
-- Each Agent's own profile, owner record and wait, read as the database's owner.
create temporary view placed as select m.name,h.profile,p.tools_level,p.tools_policy,exists(select 1 from public.agent_key_waits w where w.agent_id=m.agent) as waits
 from made m join public.hermes_agents a on a.id=m.agent join public.hermes_connections h on h.id=a.connection_id left join public.agent_profiles p on p.agent_id=m.agent;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.record_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',true)$$,'the Owner logs a key set');
reset role;
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000001'),false,'the log alone holds no key: only the server records one');
set local role service_role;
select lives_ok($$select public.begin_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter')$$,'the server begins the set');
select is(public.finish_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',true,'{}'),'{}'::text[],'and finishes it as held, with no Agent waiting');
reset role;
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000001'),true,'the Company holds a key');
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000002'),false,'the other Company holds none');

set local role service_role;
select is(public.lead_create_agent(conversation=>'e2991000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-0',agent_name=>'Writer',job=>'Writes the blog.',apps=>'{WordPress}',
  instructions=>'You write for {company}.',own_level=>1,own_policy=>public.engine_tool_policy(),own_answers=>false),jsonb_build_object('state','created','agent',(select agent from made where name='waiting')),
 'an Agent whose own profile has no model yet is made');
reset role;
update made set connection=(select connection_id from public.hermes_agents where id=made.agent) where name='waiting';
select results_eq($$select profile,tools_level,waits from placed where name='waiting'$$,$$select profile,1::smallint,true from made where name='waiting'$$,
 'it is attached to its own profile with its tools, never Lead''s, and waits for the key');
set local role service_role;
select is(public.lead_create_agent('e2991000-0000-0000-0000-000000000001','run-1','call-2','Designer','Designs the ads.','{}'),jsonb_build_object('state','created','agent',(select agent from made where name='bare')),
 'with a key held, a call that names no own profile still makes the Agent');
reset role;
select results_eq($$select profile,tools_level,tools_policy,waits from placed where name='bare'$$,$$select profile,null::smallint,null::integer,true from made where name='bare'$$,
 'on its own profile with no tools yet, waiting, never on Lead''s');
select ok(exists(select 1 from public.agent_profile_work() w where w.agent_id=(select agent from made where name='bare') and w.tools_level is null),'so the worker makes that profile, as it makes a lost one');
set local role service_role;
select is(public.lead_request_agent('e2991000-0000-0000-0000-000000000002','run-2','call-0','Social','Writes the social posts.','{}')->>'state','requested','the Manager asks for an Agent');
reset role;
select set_config('test.asked',(select id::text from public.lead_agent_requests where run_id='run-2'),true);
set local role authenticated;
select is(public.answer_agent_request('10000000-0000-0000-0000-000000000001',current_setting('test.asked')::bigint,true),'made','the Owner''s «Make it» makes it while the key is held');
reset role;
select results_eq($$select profile,tools_level,waits from placed where name='asked'$$,$$select profile,null::smallint,true from made where name='asked'$$,
 'on its own profile with no tools yet, waiting, never on Lead''s');
select is(public.agent_profile_refusal((select profile from made where name='waiting'),'10000000-0000-0000-0000-000000000001',(select agent from made where name='waiting')),'agentLevelPending',
 'every Run entry holds a waiting Agent');

set local role authenticated;
select throws_ok($$select public.reserve_conversation_run('e2992000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from made where name='waiting'),'e2993000-0000-0000-0000-000000000001','Hello')$$,
 '55000','agentLevelPending','no Run is reserved for it');
select results_eq($$select kind,title,body,asked_by,card_id,conversation_id from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='agent_key' order by title$$,
 $$values ('agent_key'::text,'Designer'::text,''::text,''::text,null::bigint,null::uuid),('agent_key','Social','','',null,null),('agent_key','Writer','','',null,null)$$,'the Owner sees each waiting, by its name');
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000002') where kind='agent_key'),0,'and nothing waits in the other Company');
select throws_ok($$select public.begin_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter')$$,'42501',null,'the Owner cannot begin a key change from the browser');
select throws_ok($$select public.finish_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',true,array[(select profile from made where name='waiting')])$$,'42501',null,
 'nor finish one, which would end a wait');
select throws_ok($$select public.forget_agent_profile_leftovers('10000000-0000-0000-0000-000000000001','{}')$$,'42501',null,'nor forget a removed Agent''s profile');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='agent_key'),0,'a Manager does not see them');
select is((select count(*)::int from public.agent_key_waits),0,'nor reads the waits');
reset role;

set local role service_role;
select lives_ok($$select public.begin_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter')$$,'the server begins the next set');
select is(public.finish_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',true,array[(select profile from made where name='waiting')]),
 array[(select profile from made where name='bare'),(select profile from made where name='asked')],'the set gave one waiting profile key and model, and the others still waiting are named');
reset role;
select is((select count(*)::int from public.agent_key_waits),2,'its wait ended, theirs did not');
select is(public.agent_profile_refusal((select profile from made where name='waiting'),'10000000-0000-0000-0000-000000000001',(select agent from made where name='waiting')),null,'then nothing holds its Runs');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_run('e2992000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select agent from made where name='waiting'),'e2993000-0000-0000-0000-000000000002','Hello'),
 (select connection from made where name='waiting'),'and a Run is reserved on its own profile');
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='agent_key' and title='Writer'),0,'and it leaves "Waiting on you"');
reset role;
set local role service_role;
select is(public.finish_provider_key_change('10000000-0000-0000-0000-000000000002','openrouter',true,(select array_agg(profile) from made where name in ('bare','asked'))),'{}'::text[],
 'a finish in another Company names none of these waits');
reset role;
select is((select count(*)::int from public.agent_key_waits),2,'and ends none of them');
set local role service_role;
select is(public.finish_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',true,(select array_agg(profile) from made where name in ('bare','asked'))),'{}'::text[],
 'the server''s next round gives the others key and model, and none waits');
select lives_ok($$select public.begin_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter')$$,'a later change begins');
select is(public.finish_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',null,'{}'),'{}'::text[],'and the Engine refuses it');
reset role;
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000001'),true,'which leaves the key held');

insert into public.agent_key_waits(agent_id,company_id) select agent,'10000000-0000-0000-0000-000000000001' from made where name='bare';
set local role service_role;
select lives_ok($$select public.begin_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter')$$,'the server begins a removal');
select is(public.finish_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter',false,'{}'),'{}'::text[],'and finishes it as not held');
reset role;
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000001'),false,'so the Company holds no key');
select is((select count(*)::int from public.agent_key_waits where company_id='10000000-0000-0000-0000-000000000001'),0,
 'and no Agent waits for one: each runs on its own profile without it, never on Lead''s');
set local role service_role;
select is(public.lead_create_agent(conversation=>'e2991000-0000-0000-0000-000000000001',run=>'run-1',call=>'call-1',agent_name=>'SEO',job=>'Writes for search.',apps=>'{}',
  own_level=>1,own_policy=>public.engine_tool_policy(),own_answers=>false)->>'agent',(select agent::text from made where name='lead'),'with no key held, a profile with no model makes the Agent');
select is(public.lead_create_agent('e2991000-0000-0000-0000-000000000001','run-1','call-3','Ads','Runs the ads.','{}')->>'agent',(select agent::text from made where name='plain'),
 'and so does a call that names no own profile');
reset role;
select results_eq($$select name,profile,tools_level,waits from placed where name in ('lead','plain') order by name$$,
 $$values ('lead'::text,'co-10000000000000000000000000000001'::text,null::smallint,false),('plain','co-10000000000000000000000000000001',null,false)$$,
 'both on Lead''s profile as before, with no profile of their own and no wait');

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
set local role service_role;
select lives_ok($$select public.forget_agent_profile_leftovers('10000000-0000-0000-0000-000000000002',array[(select profile from made where name='waiting')])$$,'the server forgets it in the other Company');
reset role;
select is((select count(*)::int from public.agent_profile_leftovers where company_id='10000000-0000-0000-0000-000000000001'),1,'which leaves it listed here');
set local role service_role;
select lives_ok($$select public.forget_agent_profile_leftovers('10000000-0000-0000-0000-000000000001',array[(select profile from made where name='waiting')])$$,'a removal left it holding no key');
reset role;
set local role authenticated;
select is((select count(*)::int from public.company_key_profiles('10000000-0000-0000-0000-000000000001') where kind='removed'),0,'so the next removal need not reach it');
reset role;
set local role service_role;
select is(public.finish_provider_key_change('10000000-0000-0000-0000-000000000002','anthropic',true,'{}'),'{}'::text[],'a set whose begin the database never took finishes all the same');
reset role;
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000002'),true,'and its hold is recorded');
insert into public.agent_key_waits(agent_id,company_id) select agent,'10000000-0000-0000-0000-000000000001' from made where name='bare';
set local role service_role;
select lives_ok($$select public.begin_provider_key_change('10000000-0000-0000-0000-000000000001','openrouter')$$,'a change the Engine never answers is left changing');
select lives_ok($$select public.settle_provider_key_holds('10000000-0000-0000-0000-000000000001','{}')$$,'the Owner''s read settles it to a space holding no key');
reset role;
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000001'),false,'so no key is held and none is changing');
select is((select count(*)::int from public.agent_key_waits where company_id='10000000-0000-0000-0000-000000000001'),0,'and no Agent waits for one');
set local role service_role;
select lives_ok($$select public.settle_provider_key_holds('10000000-0000-0000-0000-000000000001','{deepseek,"Not a provider",NULL}')$$,
 'a space holding a key the database never counted, beside names that are no provider');
reset role;
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000001'),true,'is held from that read on');
select results_eq($$select provider from public.company_key_holds where company_id='10000000-0000-0000-0000-000000000001' order by provider$$,
 $$values ('deepseek'::text),('openrouter')$$,'and the names that are no provider are skipped');
set local role authenticated;
select throws_ok($$select public.settle_provider_key_holds('10000000-0000-0000-0000-000000000001','{}')$$,'42501',null,'the Owner cannot settle the holds from the browser');
reset role;
set local role service_role;
select lives_ok($$select public.finish_provider_key_change('10000000-0000-0000-0000-000000000002','openrouter',true,'{}',false)$$,'a set the Engine never answered is finished as held, unanswered');
select lives_ok($$select public.settle_provider_key_holds('10000000-0000-0000-0000-000000000002','{}')$$,'the Owner''s read finds no key in the space yet');
reset role;
select is((select held from public.company_key_holds where company_id='10000000-0000-0000-0000-000000000002' and provider='openrouter'),true,'so the hold is kept, since the write may still land');
set local role service_role;
select lives_ok($$select public.finish_provider_key_change('10000000-0000-0000-0000-000000000002','openrouter',false,'{}')$$,'a removal the Engine answered');
reset role;
select is((select held from public.company_key_holds where company_id='10000000-0000-0000-0000-000000000002' and provider='openrouter'),false,'lets it go');
reset role;
select * from finish();
rollback;
