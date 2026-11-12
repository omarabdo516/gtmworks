import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const migration=readFileSync('supabase/migrations/20261126000000_first_run.sql','utf8');
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
drop function public.complete_setup(uuid,text,text,text), public.setup_is_open();
drop table public.setup_claim;
${migration}
select ok((select closed from public.setup_claim),'migration closes setup on an existing install');
select throws_ok($test$select public.complete_setup(gen_random_uuid(),'Owner','Company','en')$test$,'P0001','Setup closed','populated install refuses setup');
truncate public.people cascade;
select ok(not public.setup_is_open(),'deleting existing people never reopens setup');
update public.setup_claim set closed=false;
insert into auth.users(id,email) values('90000000-0000-0000-0000-000000000238','setup@example.test');
select throws_ok($test$select public.complete_setup('90000000-0000-0000-0000-000000000238','Owner','Company','fr')$test$,'P0001','Invalid setup','SQL boundary validates language');
select is((select count(*)::int from public.people),0,'invalid setup creates no person');
select ok(public.setup_is_open(),'invalid setup does not consume the claim');
select ok(public.complete_setup('90000000-0000-0000-0000-000000000238','Owner','الشركة الأولى','ar') like 'company-%','Arabic company receives a safe Home slug');
select ok(exists(select 1 from public.people p join public.members m on m.person_id=p.id join public.companies c on c.id=m.company_id where p.agency_owner and p.language='ar' and m.role='owner' and m.grant_publishing and m.grant_money_figures and m.grant_customer_data and c.name='الشركة الأولى'),'person, Agency ownership, company and full Owner membership created together');
select ok(not public.setup_is_open(),'successful setup closes the claim');
truncate public.people cascade;
select ok(not public.setup_is_open(),'deleting the new owner never reopens setup');
select * from finish();
rollback;
`;
const dir=mkdtempSync(join(tmpdir(),'gtmworks-first-run-'));
try {
 const file=join(dir,'migration.sql'); writeFileSync(file,sql);
 const result=spawnSync('npx',['--no-install','supabase','test','db',file],{stdio:'inherit'});
 process.exitCode=result.status ?? 1;
} finally { rmSync(dir,{recursive:true,force:true}); }
