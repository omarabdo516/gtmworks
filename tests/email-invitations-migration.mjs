import { readFileSync } from 'node:fs';
import { testDb } from './pgtap.mjs';

// #953: the migration ends an email invitation left pending before the release, so it can no longer be claimed, and no
// Member makes a new one. The migration is replayable, so it runs here over a pending row on the migrated schema; every
// change rolls back.
const migration=readFileSync('supabase/migrations/20270425000000_email_invitations_end.sql','utf8');
const rs='10000000-0000-0000-0000-000000000001';
const person='e9530000-0000-4000-8000-000000000010';
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
insert into auth.users(id,email) values ('${person}','left-behind@example.test');
insert into public.member_invitations(company_id,email,role,created_at) values ('${rs}','left-behind@example.test','viewer',now()-interval '2 days');
${migration}
select ok((select ended_at is not null from public.member_invitations where company_id='${rs}' and email='left-behind@example.test'),'the invitation left pending is ended by the migration');
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','${person}',true);
select lives_ok($$select public.claim_invitations()$$,'claiming an ended invitation answers without an error');
select is((select count(*)::int from public.members where company_id='${rs}' and person_id='${person}'),0,'and makes no Member');
select throws_ok($$insert into public.member_invitations(company_id,email,role) values ('${rs}','fresh@example.test','viewer')$$,'42501',null,'a Member makes no email invitation');
select throws_ok($$select public.invite_member('${rs}','fresh@example.test','viewer')$$,'42501','inviteEmailRetired','the email invitation maker refuses');
select is((select count(*)::int from public.member_invitations where email='fresh@example.test'),0,'and writes no invitation');
reset role;
select ok(to_regprocedure('public.set_invitation_agent_visible(uuid,uuid,uuid,boolean)') is not null,'the Agent switch kept for the older shape still exists');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='member_invitations' and policyname in ('invitation_insert','invitation_update') and with_check like '%can_manage_company%'),'no policy lets a Manager write one');
select * from finish();
rollback;
`;
testDb(import.meta.url,sql);
