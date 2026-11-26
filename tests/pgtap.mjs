import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A migration replay's pgTAP file, named for its script. tests/db.sh sets DB_TEST_DIR and runs every replay's file in one
// `supabase test db` (#259); run alone, a replay tests the local stack itself. CLI 3 defaults to local: never accept a
// remote target from argv or env.
export function testDb(scriptUrl, sql) {
 const name = basename(fileURLToPath(scriptUrl), '.mjs');
 if (process.env.DB_TEST_DIR) {
  writeFileSync(join(process.env.DB_TEST_DIR, `${name}.sql`), sql);
  return;
 }
 const dir = mkdtempSync(join(tmpdir(), `gtmworks-${name}-`));
 try {
  const file = join(dir, `${name}.sql`);
  writeFileSync(file, sql);
  const result = spawnSync('npx', ['--no-install', 'supabase', 'test', 'db', file], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
 } finally { rmSync(dir, { recursive: true, force: true }); }
}

// The Connection and Agent audit tables as they stood before #342 (20270213000000) dropped them, for a replay of a
// migration written against them: the tables with their grants and row-level security on, the audit's copy into the
// company log, the bundled check, and an Agent's profile not yet required. Put back inside the replay's transaction.
export const connectionsAsTheyStood=`create table public.hermes_connections(id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 owner_id uuid not null references public.people(id), address text not null, profile text not null, key_encrypted text not null,
 state text not null check (state in ('connected','refused','unreachable','untested_version')), version text, features text[] not null default '{}', unreachable_since timestamptz);
alter table public.hermes_connections enable row level security;
create policy hermes_read on public.hermes_connections for select to authenticated using (public.is_company_owner(company_id));
create policy hermes_create on public.hermes_connections for insert to authenticated with check (public.is_company_owner(company_id) and owner_id=auth.uid());
create policy hermes_replace on public.hermes_connections for update to authenticated using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));
create policy hermes_remove on public.hermes_connections for delete to authenticated using (public.is_company_owner(company_id));
grant select(id,company_id,owner_id,address,profile,state,version,features,unreachable_since),insert,delete on public.hermes_connections to authenticated;
grant update(address,profile,key_encrypted,state,version,features,unreachable_since) on public.hermes_connections to authenticated;
grant select(id,company_id,owner_id,key_encrypted,address,profile,state,features) on public.hermes_connections to service_role;
create table public.hermes_agent_audit(id bigint generated always as identity primary key, company_id uuid not null references public.companies(id), actor_id uuid not null references public.people(id),
 actor_name text, agent_id uuid not null, action text not null, details jsonb not null, created_at timestamptz not null default now());
alter table public.hermes_agent_audit enable row level security;
create policy hermes_agent_audit_read on public.hermes_agent_audit for select to authenticated using (public.is_member(company_id));
grant select on public.hermes_agent_audit to authenticated;
create function public.log_agent_change() returns trigger language plpgsql security definer set search_path='' as $stood$
begin perform public.log_agent_event(new.company_id,new.actor_id,new.actor_name,new.agent_id,new.action,new.details); return null; end $stood$;
create trigger hermes_agent_audit_company_log after insert on public.hermes_agent_audit for each row execute function public.log_agent_change();
create function public.is_bundled_connection(connection uuid) returns boolean language sql stable security definer set search_path='' as $stood$
 select exists(select 1 from public.hermes_agent_audit u where u.action in ('PROVIDE_BUNDLED_HERMES_AGENT','MOVE_COMPANY_PROFILE','REQUEST_HERMES_AGENT','MOVE_AGENT_PROFILE')
  and u.details->>'connection_id'=connection::text) $stood$;
alter table public.hermes_agents alter column profile drop not null;`;

// The legacy role agents as they stood before spec #695's cutover (20270418000001) removed them: the role key on a
// membership, its type, check and one-holder index, the shared agents and their company grants. Put back inside a
// replay's transaction, for a migration written against them.
export const roleAgentsAsTheyStood=`create type public.member_agent_role as enum ('account_manager','writer','designer','critic');
alter table public.members add column agent_role public.member_agent_role;
alter table public.members add constraint members_agent_role_check check (agent_role is null or role='contributor');
create unique index members_active_agent_role on public.members(company_id,agent_role) where agent_role is not null and removed_at is null;
create table public.agents(id uuid primary key references public.people(id), role text not null unique, created_at timestamptz not null default now());
create table public.agent_grants(company_id uuid not null references public.companies(id), agent_id uuid not null references public.agents(id),
 granted_by uuid references public.people(id), granted_at timestamptz not null default now(), revoked_by uuid references public.people(id), revoked_at timestamptz,
 primary key (company_id, agent_id));`;
