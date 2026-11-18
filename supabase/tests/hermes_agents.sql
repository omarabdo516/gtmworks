begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
-- An Owner makes an Agent the main one or removes it; Agents are no longer attached by hand (#342: one Hermes).
insert into public.hermes_agents(company_id,name,speciality,is_default,profile) values
 ('10000000-0000-0000-0000-000000000001','Mona','Writing',true,'co-10000000000000000000000000000001'),
 ('10000000-0000-0000-0000-000000000001','Nour','Design',false,'co-10000000000000000000000000000001'),
 ('10000000-0000-0000-0000-000000000002','Shared','Writing',true,'co-10000000000000000000000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','default',(select id from public.hermes_agents where name='Nour'))$$,'42501','hermesNotAllowed','a Manager cannot move the main mark');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','default',(select id from public.hermes_agents where name='Nour'))$$,'the Owner moves the main mark to another agent');
select is((select array_agg(name) from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001' and is_default),array['Nour'],'exactly one agent is main after the move, the one just made main');
select is((select actor_id::text from public.company_log where action='agent_made_main' and agent_id=(select id from public.hermes_agents where name='Nour')),'20000000-0000-0000-0000-000000000001','the log names who made it main');
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','remove',(select id from public.hermes_agents where name='Nour'))$$,'P0001','hermesNextDefault','removing the default requires choosing its successor');
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','remove',(select id from public.hermes_agents where name='Nour'),(select id from public.hermes_agents where name='Mona'))$$,'removal transfers the default atomically');
select is((select array_agg(name) from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001' and is_default),array['Mona'],'the successor is main');
select is((select details->>'replacement_id' from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and action='agent_removed' order by id desc limit 1),
 (select id::text from public.hermes_agents where name='Mona'),'the log names the successor');
reset role;
insert into public.hermes_agents(company_id,name,speciality,profile) values ('10000000-0000-0000-0000-000000000001','Nour','Design','co-10000000000000000000000000000001');
set local role authenticated;
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','remove',(select id from public.hermes_agents where name='Nour'),'ffffffff-ffff-ffff-ffff-ffffffffffff')$$,'removing a non-default agent ignores a bogus replacement');
select is((select details ? 'replacement_id' from public.company_log where company_id='10000000-0000-0000-0000-000000000001' and action='agent_removed' order by id desc limit 1),false,'the log records no replacement when no successor was applied');
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','remove','ffffffff-ffff-ffff-ffff-ffffffffffff')$$,'P0002','hermesAgentNotFound','an unknown Agent is not found');
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','attach',(select id from public.hermes_agents where name='Mona'))$$,'P0001','hermesAgentFailed','no Agent is attached by hand');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.hermes_agents),1,'member sees only their company agent');
select is((select count(*)::int from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000002'),0,'other company agents are hidden');
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','default',(select id from public.hermes_agents where name='Mona'))$$,'42501',null,'member cannot change the main Agent');
select throws_ok($$update public.hermes_agents set is_default=false$$,'42501',null,'direct writes cannot bypass default rules');
reset role;
select throws_ok($$insert into public.hermes_agents(company_id,name,speciality,is_default,profile) values ('10000000-0000-0000-0000-000000000001','Other','Design',true,'co-10000000000000000000000000000001')$$,'23505',null,'unique index independently forbids a second default');
select throws_ok($$insert into public.hermes_agents(company_id,name,speciality,profile) values ('10000000-0000-0000-0000-000000000001','Other','Design','co-10000000000000000000000000000002')$$,'42501','hermesProfileNotShared','an Agent never runs on another Company''s profile');
select ok((select relrowsecurity from pg_class where oid='public.hermes_agents'::regclass),'RLS enabled');
select ok(not has_function_privilege('anon','public.manage_hermes_agent(uuid,text,uuid,uuid)','execute'),'anonymous callers cannot manage agents');
select * from finish();
rollback;
