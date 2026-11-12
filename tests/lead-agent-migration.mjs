import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// A default agent still carrying the Engine's name becomes Lead (#286); the verify file then passes on that data.
const migration=readFileSync('supabase/migrations/20261201000000_lead_agent.sql','utf8');
const verify=readFileSync('supabase/migrations/20261201000000_lead_agent.verify.sql','utf8').trim().replace(/;$/,'');
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
insert into public.hermes_connections(id,company_id,agency_owner_id,address,profile,key_encrypted,state) values
 ('f2860000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','lead','ciphertext','connected'),
 ('f2860000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://localhost','other','ciphertext','connected'),
 ('f2860000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','http://localhost','mona','ciphertext','connected');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('a2860000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','f2860000-0000-0000-0000-000000000001','Hermes','General',true),
 ('a2860000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f2860000-0000-0000-0000-000000000002','Hermes','Writing',false),
 ('a2860000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','f2860000-0000-0000-0000-000000000003','Mona','General',true);
select ok(not (select (v.json_build_object->>'no_default_named_engine')::boolean from (${verify}) v),'the verify file sees a default agent still named after the Engine');
${migration}
select is((select name from public.hermes_agents where id='a2860000-0000-0000-0000-000000000001'),'Lead','the default agent named after the Engine is renamed Lead');
select ok((select is_default from public.hermes_agents where id='a2860000-0000-0000-0000-000000000001'),'it stays the main agent');
select is((select name from public.hermes_agents where id='a2860000-0000-0000-0000-000000000002'),'Hermes','an agent that is not the default keeps the name a person chose');
select is((select name from public.hermes_agents where id='a2860000-0000-0000-0000-000000000003'),'Mona','a default agent with another name keeps it');
set local role service_role;
select is(public.provide_bundled_hermes('http://hermes:8642','default','encrypted','0.23.0','{run_submission}'),1,'the company without an Engine is provided');
reset role;
select is((select string_agg(name||':'||is_default,',') from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000002'),'Lead:true','a company given the bundled Engine gets one agent, Lead, flagged main');
select is((select string_agg(key||'='||value,',' order by key) from (${verify}) v, json_each_text(v.json_build_object) where value<>'true'),null,'every verify check passes after the migration');
select * from finish();
rollback;
`;
const dir=mkdtempSync(join(tmpdir(),'gtmworks-lead-agent-'));
try {
 const file=join(dir,'migration.sql'); writeFileSync(file,sql);
 const result=spawnSync('npx',['--no-install','supabase','test','db',file],{stdio:'inherit'});
 process.exitCode=result.status ?? 1;
} finally { rmSync(dir,{recursive:true,force:true}); }
