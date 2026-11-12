begin;
create extension if not exists pgtap with schema extensions;
select plan(27);
insert into public.hermes_connections(id,company_id,agency_owner_id,address,profile,key_encrypted,state) values
 ('d0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','writer','ciphertext','connected'),
 ('d0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','designer','ciphertext','connected'),
 ('d0000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','HTTP://LOCALHOST:80/x/%2e%2e/','writer','ciphertext','connected'),
 ('d0000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','http://%6cocalhost','writer','ciphertext','connected');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','attach','d0000000-0000-0000-0000-000000000001',agent_name=>'Mona',speciality=>'Writing')$$,'42501',null,'two-step verification required');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','attach','d0000000-0000-0000-0000-000000000001',agent_name=>'Mona',speciality=>'Writing')$$,'Agency attaches a connected profile');
select is((select name from public.hermes_agents where is_default),'Mona','first agent becomes the default');
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000002','attach','d0000000-0000-0000-0000-000000000003',agent_name=>'Shared',speciality=>'Writing')$$,'P0001','hermesSharingWarning','a second Connection for the same profile cannot bypass confirmation');
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000002','attach','d0000000-0000-0000-0000-000000000004',agent_name=>'Encoded host',speciality=>'Writing')$$,'P0001','hermesAgentFailed','raw encoded host spellings cannot bypass confirmation');
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000002','attach','d0000000-0000-0000-0000-000000000001',agent_name=>'Shared',speciality=>'Writing',confirm_sharing=>true)$$,'explicit confirmation allows sharing the Connection');
select is((select actor_id::text from public.hermes_agent_audit where action='ATTACH_HERMES_AGENT' and details->>'sharing_confirmed'='true'),'20000000-0000-0000-0000-000000000001','audit identifies the person who confirmed');
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','attach','d0000000-0000-0000-0000-000000000002',agent_name=>'Nour',speciality=>'Design',make_default=>true)$$,'another agent can be marked default');
select is((select count(*)::int from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001' and is_default),1,'company has exactly one default');
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','remove',a=>(select id from public.hermes_agents where name='Nour'))$$,'P0001','hermesNextDefault','removing the default requires choosing its successor');
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','remove',a=>(select id from public.hermes_agents where name='Nour'),replacement=>(select id from public.hermes_agents where name='Mona'))$$,'removal transfers the default atomically');
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','default',connection=>'d0000000-0000-0000-0000-000000000002',a=>(select id from public.hermes_agents where name='Mona'))$$,'changing default resolves the affected assignment');
select is((select details->>'connection_id' from public.hermes_agent_audit where action='DEFAULT_HERMES_AGENT'),'d0000000-0000-0000-0000-000000000001','audit uses actual Connection regardless of unrelated caller input');
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','attach','d0000000-0000-0000-0000-000000000002',agent_name=>'Nour',speciality=>'Design')$$,'reattach a non-default agent');
select lives_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','remove',a=>(select id from public.hermes_agents where name='Nour'),replacement=>'ffffffff-ffff-ffff-ffff-ffffffffffff')$$,'removing a non-default agent ignores a bogus replacement');
select is((select details->'replacement_id' from public.hermes_agent_audit where company_id='10000000-0000-0000-0000-000000000001' and action='REMOVE_HERMES_AGENT' order by id desc limit 1),'null'::jsonb,'audit records no replacement when no successor was applied');
select throws_ok($$update public.hermes_connections set profile='changed' where id='d0000000-0000-0000-0000-000000000001'$$,'P0001','hermesProfileInUse','an attached Connection cannot be retargeted around the sharing check');
select throws_ok($$delete from public.hermes_connections where id='d0000000-0000-0000-0000-000000000001'$$,'23503',null,'an attached Connection cannot be deleted');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is((select count(*)::int from public.hermes_agents),1,'member sees only their company agent');
select is((select count(*)::int from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000002'),0,'other company agents are hidden');
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','attach','d0000000-0000-0000-0000-000000000002',agent_name=>'Forbidden',speciality=>'Design')$$,'42501',null,'member cannot attach');
select is((select count(*)::int from public.hermes_agent_audit where company_id='10000000-0000-0000-0000-000000000002'),0,'other company audit records are hidden');
select throws_ok($$delete from public.hermes_agent_audit$$,'42501',null,'audit records cannot be rewritten');
select throws_ok($$update public.hermes_agents set is_default=false$$,'42501',null,'direct writes cannot bypass default rules');
reset role;
select throws_ok($$insert into public.hermes_agents(company_id,connection_id,name,speciality,is_default) values ('10000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','Other','Design',true)$$,'23505',null,'unique index independently forbids a second default');
select ok((select relrowsecurity from pg_class where oid='public.hermes_agents'::regclass),'RLS enabled');
select ok(not has_function_privilege('anon','public.manage_hermes_agent(uuid,text,uuid,uuid,text,text,boolean,boolean,uuid)','execute'),'anonymous callers cannot manage agents');
select * from finish();
rollback;
