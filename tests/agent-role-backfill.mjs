import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const migration=readFileSync('supabase/migrations/20261110000000_agent_roles.sql','utf8');
// Replay the real migration against legacy members, then roll back the schema and data.
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
drop trigger member_agent_role_guard on public.members;
alter table public.members drop column agent_role;
drop type public.member_agent_role;
create temporary table legacy_agents as
select gen_random_uuid() as person_id,gen_random_uuid() as company_id,x.* from (values
 ('مدير الحساب','contributor','account_manager',false),
 ('Hermes','contributor','account_manager',false),
 ('الكاتب','contributor','writer',false),
 ('وكيل المحتوى','contributor','writer',false),
 ('المصمم','contributor','designer',false),
 ('الناقد','contributor','critic',false),
 ('غير معروف','contributor',null,false),
 ('المصمم','viewer',null,false),
 ('الكاتب','contributor','writer',true)
) x(name,role,expected,removed);
insert into public.companies(id,slug,name) select company_id,company_id::text,'Legacy test' from legacy_agents;
insert into auth.users(id) select person_id from legacy_agents;
insert into public.people(id,name) select person_id,name from legacy_agents;
insert into public.members(company_id,person_id,role,removed_at) select company_id,person_id,role::public.member_role,case when removed then now() end from legacy_agents;
${migration}
select is((select count(*)::int from public.members m join legacy_agents l using(company_id,person_id) where m.agent_role::text is not distinct from l.expected),9,'all legacy aliases are mapped using arbitrary person ids; unrelated and non-contributor members stay null');
select is((select count(*)::int from public.member_audit a join legacy_agents l using(company_id,person_id) where a.action='UPDATE' and a.after_data->>'agent_role'=l.expected),7,'backfill changes are audited with the stable key');
update public.people set name='Renamed after migration' where id in (select person_id from legacy_agents);
select is((select count(*)::int from public.members m join legacy_agents l using(company_id,person_id) where m.agent_role::text is not distinct from l.expected),9,'later display name changes do not change keys');
select is((select count(*)::int from public.members m join legacy_agents l using(company_id,person_id) where m.removed_at is not null and m.agent_role='writer'),1,'removed members can retain their key');
select ok(has_column_privilege('authenticated','public.members','agent_role','SELECT'),'Home can read the migrated column with existing grants');
select * from finish();
rollback;
`;
const dir=mkdtempSync(join(tmpdir(),'gtmworks-agent-roles-'));
try {
 const file=join(dir,'backfill.sql');
 writeFileSync(file,sql);
 const result=spawnSync('npx',['--no-install','supabase','test','db',file],{stdio:'inherit'});
 process.exitCode=result.status ?? 1;
} finally { rmSync(dir,{recursive:true,force:true}); }
