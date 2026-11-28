import { readFileSync } from 'node:fs';
import { testDb } from './pgtap.mjs';

// #953: the first step only adds, so the previous release still makes and claims email invitations while it serves; the
// cutover ends every invitation left pending (the previous release's too), closes the table and makes the maker refuse.
// Both steps replay over the migrated schema, and every change rolls back.
const first=readFileSync('supabase/migrations/20270426000000_email_invitations_end.sql','utf8');
const cutover=readFileSync('supabase/migrations/20270426000001_email_invitations_end_cutover.sql','utf8');
// The previous release's own maker, as 20270108000000 wrote it, put back so the update window is real.
const invites=readFileSync('supabase/migrations/20270108000000_member_invites.sql','utf8');
const maker=invites.slice(invites.indexOf('create function public.invite_member'),invites.indexOf('revoke all on function public.invite_member')).replace('create function','create or replace function');
const rs='10000000-0000-0000-0000-000000000001';
const owner='20000000-0000-0000-0000-000000000001';
const person='e9530000-0000-4000-8000-000000000010';
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
insert into auth.users(id,email) values ('${person}','left-behind@example.test');
insert into public.member_invitations(company_id,email,role,created_at) values ('${rs}','left-behind@example.test','viewer',now()-interval '2 days');
${maker}
${first}
select ok((select ended_at is null from public.member_invitations where company_id='${rs}' and email='left-behind@example.test'),'the first step leaves an invitation pending, as the previous release reads it');
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','${owner}',true);
select lives_ok($$select public.invite_member('${rs}','during-update@example.test','viewer')$$,'the previous release still makes an invitation during the update');
reset role;
${cutover}
select ok((select ended_at is not null from public.member_invitations where company_id='${rs}' and email='left-behind@example.test'),'the cutover ends the invitation left pending');
select ok((select ended_at is not null from public.member_invitations where company_id='${rs}' and email='during-update@example.test'),'and the one the previous release wrote between the steps');
set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','${person}',true);
select lives_ok($$select public.claim_invitations()$$,'claiming an ended invitation answers without an error');
select is((select count(*)::int from public.members where company_id='${rs}' and person_id='${person}'),0,'and makes no Member');
select throws_ok($$insert into public.member_invitations(company_id,email,role) values ('${rs}','fresh@example.test','viewer')$$,'42501',null,'a Member makes no email invitation');
select throws_ok($$select public.invite_member('${rs}','fresh@example.test','viewer')$$,'42501','inviteEmailRetired','the email invitation maker refuses');
reset role;
select ok(to_regprocedure('public.set_invitation_agent_visible(uuid,uuid,uuid,boolean)') is not null,'the Agent switch kept for the older shape still exists');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='member_invitations' and policyname in ('invitation_insert','invitation_update') and with_check like '%can_manage_company%'),'no policy lets a Manager write one');
select * from finish();
rollback;
`;
testDb(import.meta.url,sql);
