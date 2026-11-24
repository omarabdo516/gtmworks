import { readFileSync } from 'node:fs';
import { testDb } from './pgtap.mjs';

// An install updated to #701 already has Agents its people asked for, made by the release before it with no birth
// record. The migration's last statement marks every one of them born, replayed here on an Agent made as that release
// made it: its requester is never shown it born after the update, and an Agent made after the update still is, once.
const migration=readFileSync('supabase/migrations/20270415999998_agent_birth.sql','utf8');
const backfill=migration.match(/^update public\.hermes_agents set requester_born_at=[^;]*;$/m)?.[0];
if(!backfill) throw new Error('the migration marks no Agent made before it born');
const company='10000000-0000-0000-0000-000000000001';
const owner='20000000-0000-0000-0000-000000000001';
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,requested_by,created_at) values
 ('d7010000-0000-0000-0000-000000000001','${company}',gen_random_uuid(),'Old Ads','Runs the ads.',false,'co-10000000000000000000000000000001','${owner}',now()-interval '3 days');
${backfill}
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,requested_by) values
 ('d7010000-0000-0000-0000-000000000002','${company}',gen_random_uuid(),'New Ads','Runs the ads.',false,'co-10000000000000000000000000000001','${owner}');
set local role authenticated;
select set_config('request.jwt.claim.sub','${owner}',true);
select is(public.mark_agent_born('d7010000-0000-0000-0000-000000000001'),false,'an Agent asked for before the update is not born again after it');
select is(public.mark_agent_born('d7010000-0000-0000-0000-000000000002'),true,'an Agent made after it is born for its requester');
select is(public.mark_agent_born('d7010000-0000-0000-0000-000000000002'),false,'once');
select * from finish();
rollback;
`;
testDb(import.meta.url, sql);
