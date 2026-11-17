import { readFileSync } from 'node:fs';
import { testDb } from './pgtap.mjs';
import { topLevelStatements } from './sql-statements.mjs';

// An install updated to #299 holds each provider's key its log last says was set, and none its log says was removed,
// with no change under way and no set unanswered, so an Agent made right after the update waits only when the Company's
// log says it holds a key. Each Agent removed before the update, in a Company that ever set a key, is kept by its own
// profile's name for the next key removal. The migration's two inserts are replayed on rows of the logs; the database
// this runs on has the migration.
const statements=topLevelStatements(readFileSync('supabase/migrations/20270120000000_agent_key_waits.sql','utf8'));
const insertsInto=table=>{
 const found=statements.filter(statement=>new RegExp(`^insert\\s+into\\s+public\\.${table}\\b`,'i').test(statement));
 if(found.length!==1) throw new Error(`expected one insert into ${table}, found ${found.length}`);
 return found[0];
};
const seed=insertsInto('company_key_holds'); const leftovers=insertsInto('agent_profile_leftovers');
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
-- RS Learning (1) set an OpenRouter key and removed it in one transaction, and set an Anthropic key. R&S Consultations
-- (2) removed a DeepSeek key after its set, as dated, though the set was written later. The third Company changed none.
insert into public.company_audit(company_id,actor_id,action,provider,created_at) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','provider_key_set','openrouter',now()),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','provider_key_removed','openrouter',now()),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','provider_key_set','anthropic',now()),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','provider_key_removed','deepseek',now()),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','provider_key_set','deepseek',now()-interval '1 day');
delete from public.company_key_holds;
${seed};
select results_eq($$select company_id,provider,held,changing,uncertain,changed_at from public.company_key_holds order by company_id,provider$$,
 $$values ('10000000-0000-0000-0000-000000000001'::uuid,'anthropic'::text,true,false,false,null::timestamptz),('10000000-0000-0000-0000-000000000001','openrouter',false,false,false,null),
  ('10000000-0000-0000-0000-000000000002','deepseek',false,false,false,null)$$,'each Company and provider holds what its log last says, by date and then by order, with no change under way and none unanswered');
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000001'),true,'RS Learning holds a key');
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000002'),false,'R&S Consultations, whose log last says removed, holds none');
select is(public.company_holds_provider_key('10000000-0000-0000-0000-000000000003'),false,'nor does a Company that never gave one');
-- RS Learning removed an Agent Lead made as Old writer and one added by hand, and Lead, which is back; the third Company,
-- which never set a key, removed one too.
insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values
 ('e2990000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','http://127.0.0.1:9','co-10000000000000000000000000000001','ciphertext','connected','0.23.0','{run_submission}');
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
 ('e2990000-0000-0000-0000-0000000000a9','10000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-0000000000c1','Lead','General',true);
insert into public.hermes_agent_audit(company_id,actor_id,agent_id,action,details) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-0000000000a1','REQUEST_HERMES_AGENT',jsonb_build_object('agent_name','Writer')),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-0000000000a1','REQUEST_HERMES_AGENT',jsonb_build_object('agent_name','Old writer')),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-0000000000a1','REMOVE_HERMES_AGENT','{}'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-0000000000a2','REMOVE_HERMES_AGENT','{}'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-0000000000a9','REMOVE_HERMES_AGENT','{}'),
 ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-0000000000a3','REQUEST_HERMES_AGENT',jsonb_build_object('agent_name','Elsewhere')),
 ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-0000000000a3','REMOVE_HERMES_AGENT','{}');
delete from public.agent_profile_leftovers;
${leftovers};
select results_eq($$select profile,company_id,agent_id,agent_name from public.agent_profile_leftovers order by profile$$,
 $$values ('ag-e29900000000000000000000000000a1'::text,'10000000-0000-0000-0000-000000000001'::uuid,'e2990000-0000-0000-0000-0000000000a1'::uuid,'Old writer'::text),
  ('ag-e29900000000000000000000000000a2','10000000-0000-0000-0000-000000000001','e2990000-0000-0000-0000-0000000000a2',null)$$,
 'each Agent removed in a Company that set a key is kept by its profile, named as it was last asked for, and none still there or elsewhere');
select * from finish();
rollback;
`;
testDb(import.meta.url,sql);
