import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const defaults=readFileSync('scripts/local-default-privileges.sql','utf8');
// Observe freshly created objects, including direct function grants after PUBLIC is revoked.
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
-- A CLI image may omit these defaults; the bootstrap must supply every one.
alter default privileges for role postgres in schema public
 revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
 revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
 revoke all on functions from anon, authenticated, service_role;
${defaults}
create table public.ci_hosted_table (id integer);
create view public.ci_hosted_view as select id from public.ci_hosted_table;
create sequence public.ci_hosted_sequence;
create function public.ci_hosted_function() returns integer language sql as $$ select 1 $$;
revoke execute on function public.ci_hosted_function() from public;
select is(
 (select string_agg(a.privilege_type, ', ' order by a.privilege_type)
  from pg_class c cross join lateral aclexplode(c.relacl) a
  where c.oid=object_name::regclass and a.grantee=role_name::regrole),
 expected,
 format('hosted %s defaults for %s: %s', object_type, role_name, expected)
)
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values
 ('table','public.ci_hosted_table','DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE'),
 ('view','public.ci_hosted_view','DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE'),
 ('sequence','public.ci_hosted_sequence','SELECT, UPDATE, USAGE')
) objects(object_type, object_name, expected);
select is(
 (select string_agg(a.privilege_type, ', ' order by a.privilege_type)
  from pg_proc p cross join lateral aclexplode(p.proacl) a
  where p.oid='public.ci_hosted_function()'::regprocedure and a.grantee=role_name::regrole),
 'EXECUTE', format('hosted function defaults for %s: EXECUTE', role_name)
)
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);
select * from finish();
rollback;
`;
const dir=mkdtempSync(join(tmpdir(),'gtmworks-hosted-defaults-'));
try {
 const file=join(dir,'defaults.sql');
 writeFileSync(file,sql);
 const result=spawnSync('npx',['--no-install','supabase','test','db',file],{stdio:'inherit'});
 process.exitCode=result.status ?? 1;
} finally { rmSync(dir,{recursive:true,force:true}); }
