import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const team=readFileSync('supabase/migrations/20261105000000_team.sql','utf8');
const roles=readFileSync('supabase/migrations/20261111000000_member_agent_roles.sql','utf8');
const verify=readFileSync('supabase/migrations/20261111000000_member_agent_roles.verify.sql','utf8');
const migration=readFileSync('supabase/migrations/20261113000000_close_anonymous_function_access.sql','utf8');
const defaults=readFileSync('scripts/local-default-privileges.sql','utf8');
// Recreate the real legacy claim under local default grants; roll back every change.
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
${defaults}
drop function public.claim_invitations();
${team.slice(team.indexOf('create function public.claim_invitations()'))}
${roles.slice(roles.indexOf('create or replace function public.claim_invitations()'))}
create temporary view legacy_verification as ${verify}
select is((select json_build_object->>'anonymous_claim_blocked' from legacy_verification),'false','unchanged legacy verify detects the default anon grant');
select is((select count(*)::int from legacy_verification, json_each(json_build_object) where value::text<>'true'),1,'anonymous_claim_blocked is the only legacy failure');
${migration}
select ok((select bool_and(value::text='true') from legacy_verification, json_each(json_build_object)),'forward migration makes every unchanged legacy check pass');
${migration}
select ok((select bool_and(value::text='true') from legacy_verification, json_each(json_build_object)),'forward migration is safe to repeat');
select ok(has_function_privilege('authenticated','public.claim_invitations()','EXECUTE'),'authenticated claiming survives the repair');
select * from finish();
rollback;
`;
const dir=mkdtempSync(join(tmpdir(),'gtmworks-function-grants-'));
try {
 const file=join(dir,'migration.sql');
 writeFileSync(file,sql);
 const result=spawnSync('npx',['--no-install','supabase','test','db',file],{stdio:'inherit'});
 process.exitCode=result.status ?? 1;
} finally { rmSync(dir,{recursive:true,force:true}); }
