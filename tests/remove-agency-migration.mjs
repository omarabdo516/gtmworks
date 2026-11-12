import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// The Agency and the reviewer Role are removed (#7, ADR 0012). The database is put back in its earlier shape inside
// the transaction (the reviewer Role, the Agency flag, a policy using the bypass), a reviewer is seeded, and the real
// migration runs on it; the verify file is red before and green after. Everything rolls back.
// The migration runs as the installer runs it: inside one explicit transaction, followed by its history row in that same
// transaction. A refused migration rolls back to the savepoint throws_ok makes, so it leaves no change and no history row.
const migration=readFileSync('supabase/migrations/20261204000000_remove_agency.sql','utf8');
const name='20261204000000_remove_agency.sql';
const applied=`${migration}\ninsert into pg_temp.migration_history values ('${name}');`;
const verify=readFileSync('supabase/migrations/20261204000000_remove_agency.verify.sql','utf8').trim().replace(/;$/,'');
const rs='10000000-0000-0000-0000-000000000001', omar='20000000-0000-0000-0000-000000000001', manager='20000000-0000-0000-0000-000000000002', reviewer='20000000-0000-0000-0000-000000000003', aleem='10000000-0000-0000-0000-000000000003';
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
create temporary table migration_history(name text primary key);
-- The earlier shape: the role type with reviewer, the Agency flag and functions, and a policy that uses them.
drop policy agent_keys_owner_read on public.agent_keys; drop policy agent_keys_owner_create on public.agent_keys; drop policy agent_keys_owner_update on public.agent_keys;
drop policy agent_refusals_owner_read on public.agent_refusals; drop policy agent_webhooks_owner on public.agent_webhooks; drop policy webhook_deliveries_owner_read on public.webhook_deliveries;
drop policy invitation_insert on public.member_invitations; drop policy invitation_update on public.member_invitations;
alter table public.approval_steps drop constraint approval_steps_approver_role;
-- A CHECK constraint naming the type in a literal is re-read with the renamed type, so these two go and come back.
alter table public.members drop constraint members_agent_role_check; alter table public.role_permissions drop constraint no_contributor_viewer_approval;
drop function public.save_approval_step(uuid,bigint,text,integer,uuid,public.member_role);
alter type public.member_role rename to member_role_current;
create type public.member_role as enum ('owner','manager','contributor','reviewer','viewer');
alter table public.members alter column role type public.member_role using role::text::public.member_role;
alter table public.member_invitations alter column role type public.member_role using role::text::public.member_role;
alter table public.role_permissions alter column role type public.member_role using role::text::public.member_role;
alter table public.approval_steps alter column role type public.member_role using role::text::public.member_role;
drop type public.member_role_current;
alter table public.approval_steps add check (role is null or role in ('owner','manager','reviewer'));
alter table public.members add constraint members_agent_role_check check (agent_role is null or role='contributor');
alter table public.role_permissions add constraint no_contributor_viewer_approval check (not (role in ('contributor','viewer') and permission in ('approve','reject') and allowed));
create function public.save_approval_step(c uuid, step bigint, step_name text, step_position integer, member uuid, member_role public.member_role) returns void language sql as $legacy$ select $legacy$;
alter table public.people add column agency_owner boolean not null default false;
alter table public.hermes_connections rename column owner_id to agency_owner_id;
-- Connections could be retargeted before this migration: its destination guard did not exist yet.
drop trigger hermes_retarget_refused on public.hermes_connections; drop function public.keep_hermes_destination();
create function public.is_agency_owner() returns boolean language sql stable security definer set search_path='' as $legacy$ select exists(select 1 from public.people where id=auth.uid() and agency_owner) $legacy$;
create function public.agency_access() returns boolean language sql stable security definer set search_path='' as $legacy$ select public.is_agency_owner() and coalesce(auth.jwt()->>'aal','')='aal2' $legacy$;
create policy company_agency_read on public.companies for select to authenticated using (public.agency_access());

-- A reviewer, everything addressed to one, and an Agency owner's Connection.
update public.people set agency_owner=true where id='${omar}';
update public.members set role='reviewer' where company_id='${rs}' and person_id='${reviewer}';
insert into public.member_invitations(company_id,email,role) values ('${rs}','former-reviewer@example.com','reviewer');
insert into public.role_permissions(company_id,role,permission,allowed) values ('${rs}','reviewer','approve',true) on conflict do nothing;
insert into public.approval_steps(id,company_id,name,position,role) overriding system value values (970001,'${rs}','Reviewers',90,'reviewer');
insert into public.approval_steps(id,company_id,name,position,person_id) overriding system value values (970002,'${rs}','One reviewer',91,'${reviewer}');
select set_config('approval.internal','yes',true);
update public.work_cards set approval_step_id=970002, next_actor='${reviewer}' where id=(select min(id) from public.work_cards where company_id='${rs}');
select set_config('approval.internal','',true);
insert into public.hermes_connections(id,company_id,agency_owner_id,address,profile,key_encrypted,state) values ('f7000000-0000-0000-0000-000000000001','${rs}','${omar}','http://localhost','former-agency','ciphertext','connected');
select is((select string_agg(key,',' order by key) from (${verify}) v, json_each_text(v.json_build_object) where key in ('roles','no_agency_flag','no_agency_functions','no_agency_policy','connection_owner') and value='false'),'connection_owner,no_agency_flag,no_agency_functions,no_agency_policy,roles','the verify file is red on the earlier shape');
-- Aleem has no active Manager (a removed one does not count): its live reviewer step would wait for nobody, so the whole
-- migration stops and nothing changes. throws_ok runs it in a savepoint, so the earlier shape is still here afterwards.
insert into public.members(company_id,person_id,role,removed_at) values ('${aleem}','${manager}','manager',now());
insert into public.approval_steps(id,company_id,name,position,role) overriding system value values (970003,'${aleem}','Aleem reviewers',90,'reviewer');
select throws_ok($migration$${applied}$migration$,'P0001','Approval steps for reviewers have no active Manager to take them in: aleem. Make a Member of each of these Companies a Manager, then update again.','with no active Manager to take a reviewer step the migration fails');
select is((select string_agg(coalesce(role::text,'-')||':'||coalesce(person_id::text,'-'),',' order by id) from public.approval_steps where id in (970001,970002,970003)),'reviewer:-,-:${reviewer},reviewer:-','the failed migration leaves every step as it was');
select is((select role::text from public.members where company_id='${rs}' and person_id='${reviewer}'),'reviewer','the failed migration leaves the reviewer as they were');
select is((select next_actor from public.work_cards where approval_step_id=970002),'${reviewer}'::uuid,'the failed migration leaves the waiting card as it was');
select ok(to_regprocedure('public.agency_access()') is not null,'the failed migration leaves the Agency functions in place');
select is((select count(*)::int from pg_temp.migration_history),0,'the failed migration records no history');
-- A removed step needs no Manager: it is converted, never refused.
update public.approval_steps set removed_at=now() where id=970003;
${applied}
select is((select string_agg(name,',') from pg_temp.migration_history),'${name}','the applied migration records its history in the same transaction');
select is((select role::text from public.approval_steps where id=970003),'manager','a removed reviewer step is converted without a Manager');
select is((select role::text from public.members where company_id='${rs}' and person_id='${reviewer}'),'contributor','a former reviewer is a Contributor');
select is((select role::text from public.member_invitations where email='former-reviewer@example.com'),'contributor','an open reviewer invitation becomes a Contributor invitation');
select is((select count(*)::int from public.role_permissions where company_id='${rs}' and role::text not in ('owner','manager','contributor','viewer')),0,'no permission row is left for the reviewer Role');
select is((select string_agg(coalesce(role::text,'-')||':'||coalesce(person_id::text,'-'),',' order by id) from public.approval_steps where id in (970001,970002)),'manager:-,manager:-','steps addressed to reviewers go to Managers');
select is((select next_actor from public.work_cards where approval_step_id=970002),'${manager}'::uuid,'a card waiting for a former reviewer waits for a Manager');
select is((select count(*)::int from public.approval_steps where role::text='contributor'),0,'no step is addressed to Contributors, who never approve');
select is((select owner_id from public.hermes_connections where id='f7000000-0000-0000-0000-000000000001'),'${omar}'::uuid,'the Connection keeps the person who made it as its owner');
set local role authenticated;
select set_config('request.jwt.claim.sub','${omar}',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select is((select count(*)::int from public.hermes_connections where id='f7000000-0000-0000-0000-000000000001'),1,'the company Owner manages it without two-step verification');
select set_config('request.jwt.claim.sub','${manager}',true);
select is((select count(*)::int from public.hermes_connections),0,'a Manager does not read Connections');
reset role;
select is((select string_agg(key||'='||value,',' order by key) from (${verify}) v, json_each_text(v.json_build_object) where value<>'true'),null,'every verify check passes after the migration');
select * from finish();
rollback;
`;
const dir=mkdtempSync(join(tmpdir(),'gtmworks-remove-agency-'));
try {
 const file=join(dir,'migration.sql'); writeFileSync(file,sql);
 const result=spawnSync('npx',['--no-install','supabase','test','db',file],{stdio:'inherit'});
 process.exitCode=result.status ?? 1;
} finally { rmSync(dir,{recursive:true,force:true}); }
