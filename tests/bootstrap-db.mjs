import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bootstrapSql } from '../scripts/bootstrap-owner.mjs';

const owner='bootstrap-owner@example.test';
const other='bootstrap-other@example.test';
const quote=sql=>`'${sql.replaceAll("'","''")}'`;
// Run the production SQL with real triggers and constraints, without changing seeded data.
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
update public.companies set slug='bootstrap-original' where slug='rs-learning';
insert into auth.users(id,email) values
 ('90000000-0000-0000-0000-000000000001','${owner}'),
 ('90000000-0000-0000-0000-000000000002','${other}');
select throws_ok(${quote(bootstrapSql('missing-bootstrap@example.test'))},'P0001','Auth user must exist before bootstrap','missing Auth user refused');
select is((select count(*)::int from public.companies where slug='rs-learning'),0,'missing Auth user creates no company');
${bootstrapSql(owner)}
select is((select count(*)::int from public.companies where slug='rs-learning'),1,'company created once');
select is((select name from public.companies where slug='rs-learning'),'RS Learning','company name');
select is((select count(*)::int from public.members m join public.companies c on c.id=m.company_id where c.slug='rs-learning' and m.role='owner' and m.removed_at is null),1,'one active Owner');
select ok((select grant_publishing and grant_money_figures and grant_customer_data from public.members m join public.companies c on c.id=m.company_id where c.slug='rs-learning'),'all Owner grants');
select ok((select agency_owner from public.people where id='90000000-0000-0000-0000-000000000001'),'Omar can enroll TOTP through the existing settings screen');
select is((select count(*)::int from public.approval_steps s join public.companies c on c.id=s.company_id where c.slug='rs-learning' and s.role='owner'),1,'Owner-only default approval');
select set_config('test.bootstrap_before', (select md5(jsonb_build_object(
 'company',(select to_jsonb(c) from public.companies c where slug='rs-learning'),
 'person',(select to_jsonb(p) from public.people p where id='90000000-0000-0000-0000-000000000001'),
 'member',(select to_jsonb(m) from public.members m where person_id='90000000-0000-0000-0000-000000000001'),
 'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.member_audit a where person_id='90000000-0000-0000-0000-000000000001')
)::text)),true);
${bootstrapSql(owner)}
select is((select count(*)::int from public.members m join public.companies c on c.id=m.company_id where c.slug='rs-learning' and m.role='owner' and m.removed_at is null),1,'second bootstrap leaves one Owner');
select is((select md5(jsonb_build_object(
 'company',(select to_jsonb(c) from public.companies c where slug='rs-learning'),
 'person',(select to_jsonb(p) from public.people p where id='90000000-0000-0000-0000-000000000001'),
 'member',(select to_jsonb(m) from public.members m where person_id='90000000-0000-0000-0000-000000000001'),
 'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.member_audit a where person_id='90000000-0000-0000-0000-000000000001')
)::text)),current_setting('test.bootstrap_before'),'rerun changes no rows or audit entries');
select throws_ok(${quote(bootstrapSql(other))},'P0001','RS Learning already has an Owner; bootstrap refuses a second Owner','second Owner refused');
select is((select count(*)::int from public.people where id='90000000-0000-0000-0000-000000000002'),0,'refusal creates no person');
select is((select count(*)::int from public.members m join public.companies c on c.id=m.company_id where c.slug='rs-learning' and m.role='owner' and m.removed_at is null),1,'refusal leaves one Owner');
update public.members set role='viewer' where person_id='90000000-0000-0000-0000-000000000001';
update public.companies set name='Existing RS' where slug='rs-learning';
${bootstrapSql(owner)}
select is((select role::text from public.members where person_id='90000000-0000-0000-0000-000000000001'),'owner','existing membership promoted when no Owner exists');
select is((select name from public.companies where slug='rs-learning'),'Existing RS','existing company kept');
select * from finish();
rollback;
`;
const dir=mkdtempSync(join(tmpdir(),'gtmworks-bootstrap-db-'));
try {
 const file=join(dir,'bootstrap.sql');
 writeFileSync(file,sql);
 // CLI 3 defaults to local. Never accept a remote target from argv or env.
 const result=spawnSync('npx',['--no-install','supabase','test','db',file],{stdio:'inherit'});
 process.exitCode=result.status ?? 1;
} finally { rmSync(dir,{recursive:true,force:true}); }
