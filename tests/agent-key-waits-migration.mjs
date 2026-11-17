import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { topLevelStatements } from './sql-statements.mjs';

// An install updated to #299 holds each provider's key its log last says was set, and none its log says was removed,
// each left changing until this version settles it, so an Agent made right after the update waits when the Company
// ever gave a key: a set whose log write failed may hide behind a logged removal. The migration's one insert is
// replayed on rows of the log; the database this runs on has the migration.
const seed=topLevelStatements(readFileSync('supabase/migrations/20270115000000_agent_key_waits.sql','utf8')).filter(statement=>/^insert\s+into\s+public\.company_key_holds\b/i.test(statement));
if(seed.length!==1) throw new Error(`expected one insert into company_key_holds, found ${seed.length}`);
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
-- RS Learning (1) set an OpenRouter key and removed it in one transaction, and set an Anthropic key. R&S Consultations
-- (2) removed a DeepSeek key after its set, as dated, though the set was written later. The third Company changed none.
insert into public.company_audit(company_id,actor_id,action,provider,created_at) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','provider_key_set','openrouter',now()),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','provider_key_removed','openrouter',now()),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','provider_key_set','anthropic',now()),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','provider_key_removed','deepseek',now()),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','provider_key_set','deepseek',now()-interval '1 day');
delete from public.company_key_holds;
${seed[0]};
select results_eq($$select company_id,provider,held,changing from public.company_key_holds order by company_id,provider$$,
 $$values ('10000000-0000-0000-0000-000000000001'::uuid,'anthropic'::text,true,true),('10000000-0000-0000-0000-000000000001','openrouter',false,true),
  ('10000000-0000-0000-0000-000000000002','deepseek',false,true)$$,'each Company and provider holds what its log last says, by date and then by order, unsettled');
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000001'),true,'RS Learning holds a key');
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000002'),true,'R&S Consultations, whose log last says removed, waits too until it is settled');
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000003'),false,'nor does a Company that never gave one');
select * from finish();
rollback;
`;
const dir=mkdtempSync(join(tmpdir(),'gtmworks-agent-key-waits-'));
try {
 const file=join(dir,'migration.sql'); writeFileSync(file,sql);
 const result=spawnSync('npx',['--no-install','supabase','test','db',file],{stdio:'inherit'});
 process.exitCode=result.status ?? 1;
} finally { rmSync(dir,{recursive:true,force:true}); }
