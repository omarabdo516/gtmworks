begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
-- #345. RS Learning's Lead runs on the Company's profile, Ads on its own, Writer's own profile is not made yet; Aleem's
-- Lead on Aleem's profile. The worker writes each listed profile's SOUL.md section from this list.
insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) values
 ('e8000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',1,public.engine_tool_policy());
insert into public.agent_profiles(agent_id,company_id) values ('e8000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001');
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('e8000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','co-10000000000000000000000000000001','ciphertext','connected','0.23.0','{run_submission}'),
 ('e8000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','ag-e8000000000000000000000000000012','ciphertext','connected','0.23.0','{run_submission}'),
 ('e8000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','ag-e8000000000000000000000000000013','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('e8000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001','Lead','General',true),
 ('e8000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000002','Ads','Ads',false),
 ('e8000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000003','Writer','SEO',false);
insert into public.company_profiles(company_id,profile,tools_level,tools_policy) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',1,public.engine_tool_policy());
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('e8100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000012','Ads');
-- Ads's rules: one the Owner told, one approved, one waiting, one refused, one removed; Lead's: one the Owner told.
insert into public.agent_rules(company_id,agent_id,body,said_by,said_at,conversation_id,run_id,call_id,suggestion,decided_by,decided_at,removed_at,removed_by) values
 ('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000012','No emojis','20000000-0000-0000-0000-000000000001',now()-interval '5 minutes','e8100000-0000-0000-0000-000000000001','r1','c',null,null,null,null,null),
 ('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000012','Light Saudi dialect','20000000-0000-0000-0000-000000000003',now()-interval '4 minutes','e8100000-0000-0000-0000-000000000001','r2','c','approved','20000000-0000-0000-0000-000000000001',now(),null,null),
 ('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000012','Waiting one','20000000-0000-0000-0000-000000000003',now()-interval '3 minutes','e8100000-0000-0000-0000-000000000001','r3','c','pending',null,null,null,null),
 ('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000012','Refused one','20000000-0000-0000-0000-000000000003',now()-interval '2 minutes','e8100000-0000-0000-0000-000000000001','r4','c','rejected','20000000-0000-0000-0000-000000000001',now(),null,null),
 ('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000012','Removed one','20000000-0000-0000-0000-000000000001',now()-interval '1 minute','e8100000-0000-0000-0000-000000000001','r5','c',null,null,null,now(),'20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000011','Sign every reply','20000000-0000-0000-0000-000000000001',now(),'e8100000-0000-0000-0000-000000000001','r6','c',null,null,null,null,null);

set local role service_role;
select results_eq($$select profile,rules from public.agent_soul_rules_work() where profile like '%e8%' or profile='co-10000000000000000000000000000001' order by profile$$,
 $$values ('ag-e8000000000000000000000000000012','["No emojis","Light Saudi dialect"]'::jsonb),('co-10000000000000000000000000000001','["Sign every reply"]'::jsonb)$$,
 'each Agent profile is listed with its team''s rules in force, oldest first: none waiting, refused or removed; a profile not made yet is not listed');
reset role;
update public.agent_rules set removed_at=now(),removed_by='20000000-0000-0000-0000-000000000001' where run_id='r6';
set local role service_role;
select is((select rules from public.agent_soul_rules_work() where profile='co-10000000000000000000000000000001'),'[]'::jsonb,'a profile whose rules were all removed is listed with none, so its section goes');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select throws_ok($$select * from public.agent_soul_rules_work()$$,'42501',null,'only the worker lists them, not even the Owner');
reset role;
select ok(not has_function_privilege('anon','public.agent_soul_rules_work()','execute'),'nor anyone signed out');

-- No Run is told rules any more (#345): the per-person list is gone, and what a Run's row would name answers none.
select hasnt_function('public','agent_rules_in_force',array['uuid','uuid'],'the rules a person''s Run was told are gone');
select is(public.agent_rules_in_force('e8000000-0000-0000-0000-000000000012'),'{}'::text[],'a channel or note Run of Ads is told no rules');
select ok(position('agent_rules_in_force' in pg_get_functiondef('public.pin_run(uuid,uuid,jsonb)'::regprocedure))=0,'a conversation Run pins none');
-- The record, who reads it and the log stay: company separation on agent_rules is unchanged.
-- The multi-Company Member, here a Contributor of Aleem only.
update public.members set removed_at=now() where company_id='10000000-0000-0000-0000-000000000001' and person_id='20000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is((select count(*)::int from public.agent_rules where company_id='10000000-0000-0000-0000-000000000001'),0,'a person of another Company reads none of these rules');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.agent_rules where agent_id='e8000000-0000-0000-0000-000000000012'),5,'the Owner reads every rule of Ads');
reset role;
select * from finish();
rollback;
