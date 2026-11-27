import { readFileSync } from 'node:fs';
import { testDb } from './pgtap.mjs';

// An install set up before #915 has no install owner recorded. The migration names the account first-run made, the
// install's earliest account that is still an active Administrator: never an Administrator a later Company's
// first-Administrator link brought in, nor an earlier account that is no Administrator (a sign-in a failed first-run left
// behind, later invited at another Role). Replayed here on the seed with its record removed, with the first-run account
// made a day before the later Administrator and a Manager made before both.
const migration=readFileSync('supabase/migrations/20270422000000_install_owner.sql','utf8');
const backfill=migration.match(/^insert into public\.install_owner\(person_id\)\nselect [^;]*;$/m)?.[0];
if(!backfill) throw new Error('the migration records no install owner for an install set up before it');
const first='20000000-0000-0000-0000-000000000001';
const later='20000000-0000-0000-0000-000000000005';
const manager='20000000-0000-0000-0000-000000000002';
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
delete from public.install_owner;
update auth.users set created_at=now()-interval '1 day' where id='${first}';
update auth.users set created_at=now()-interval '2 days' where id='${manager}';
update public.members set role='owner' where person_id='${later}';
${backfill}
select is((select person_id from public.install_owner),'${first}'::uuid,'the install''s first account is its install owner');
set local role authenticated;
select set_config('request.jwt.claim.sub','${later}',true);
select ok(not public.is_install_owner(),'an Administrator who came later is not');
select set_config('request.jwt.claim.sub','${manager}',true);
select ok(not public.is_install_owner(),'nor an earlier account that is no Administrator');
select set_config('request.jwt.claim.sub','${first}',true);
select ok(public.is_install_owner(),'the first-run Administrator is');
select * from finish();
rollback;
`;
testDb(import.meta.url, sql);
