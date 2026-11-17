import { readFileSync } from 'node:fs';
import { testDb } from './pgtap.mjs';

// An install updated to #121 runs the previous app version until the new one starts: on the migrated database its calls
// to reserve, record and close a Run, its lead_create_agent and its move_company_profile answer as before, and an Agent it
// makes on Lead's profile is then moved to its own by the new functions. The database this runs on has the migration.
const verify=readFileSync('supabase/migrations/20261228000000_agent_profile_moves.verify.sql','utf8').trim().replace(/;$/,'');
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
-- RS Learning (1) runs Lead on its own profile; R&S Consultations (2) still runs Lead on the shared default profile.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('c1210000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','co-10000000000000000000000000000001','ciphertext','connected','0.23.0','{run_submission}'),
 ('c1210000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','default','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('c1220000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c1210000-0000-0000-0000-000000000001','Lead','General',true),
 ('c1220000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','c1210000-0000-0000-0000-000000000002','Lead','General',true);
insert into public.hermes_agent_audit(company_id,actor_id,agent_id,action,details) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','c1220000-0000-0000-0000-000000000001','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','c1210000-0000-0000-0000-000000000001')),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','c1220000-0000-0000-0000-000000000002','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','c1210000-0000-0000-0000-000000000002'));
insert into public.company_profiles(company_id,profile,tools_level,tools_policy,skills_shared) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy(),true),
 ('10000000-0000-0000-0000-000000000002','co-10000000000000000000000000000002',1,public.engine_tool_policy(),true);
create temporary table made(agent uuid);
grant all on made to service_role;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is(public.reserve_conversation_turn('c1230000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c1220000-0000-0000-0000-000000000001','c1240000-0000-0000-0000-000000000001','I want a writer')->>'connection',
 'c1210000-0000-0000-0000-000000000001','the previous version reserves a Run on Lead''s profile');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.begin_start('c1230000-0000-0000-0000-000000000001','c1240000-0000-0000-0000-000000000001'),1,'begins its start');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select ok(public.send_conversation_message('c1230000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c1220000-0000-0000-0000-000000000001','I want a writer',
 'c1240000-0000-0000-0000-000000000001','run-121','c1210000-0000-0000-0000-000000000001'),'records it');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select ok(public.close_conversation_run('c1230000-0000-0000-0000-000000000001','run-121','completed','The writer is on the team.',null,10,5),'and closes it with its reply');
insert into made select (public.lead_create_agent('c1230000-0000-0000-0000-000000000001','run-121','call-1','Writer','Writes the blog.','{}')->>'agent')::uuid;
select ok((select agent from made) is not null,'its lead_create_agent call, with its old arguments, makes the Agent');
select is(public.move_company_profile('10000000-0000-0000-0000-000000000002','http://hermes:8642','encrypted','0.23.0','{run_submission}'),1,
 'and its move_company_profile moves a Company from the shared profile to its own');
reset role;
select is((select h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=(select agent from made)),'co-10000000000000000000000000000001',
 'the Agent it made runs on Lead''s profile');
select is((select h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id='c1220000-0000-0000-0000-000000000002'),'co-10000000000000000000000000000002',
 'and the moved Company''s Lead on its own');

set local role service_role;
select results_eq($$select agent_id from public.agent_move_work() where company_id='10000000-0000-0000-0000-000000000001'$$,$$select agent from made$$,'the new worker lists the Agent it made');
select ok(public.begin_agent_profile_move((select agent from made)),'begins its move');
select public.record_agent_profile(agent,'ag-'||replace(agent::text,'-',''),1,public.engine_tool_policy()) from made;
reset role;
update public.agent_profiles set skills_shared=true where agent_id=(select agent from made);
set local role service_role;
select ok(public.move_agent_profile((select agent from made)),'and moves it to its own profile');
reset role;
select is((select h.profile from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=(select agent from made)),(select 'ag-'||replace(agent::text,'-','') from made),
 'the Agent now runs on its own profile');
select is((select string_agg(key||'='||value,',' order by key) from (${verify}) v, json_each_text(v.json_build_object) where value<>'true'),null,'every verify check passes after the migration');
select * from finish();
rollback;
`;
testDb(import.meta.url,sql);
