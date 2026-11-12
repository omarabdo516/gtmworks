create table public.hermes_connections (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 agency_owner_id uuid not null references public.people(id),
 address text not null,
 profile text not null,
 key_encrypted text not null,
 state text not null check (state in ('connected','refused','unreachable','untested_version')),
 version text,
 features text[] not null default '{}',
 unreachable_since timestamptz,
 check (state='connected' or cardinality(features)=0)
);
alter table public.hermes_connections enable row level security;
create policy hermes_read on public.hermes_connections for select to authenticated using (
 (agency_owner_id=auth.uid() and public.agency_access()) or
 (not public.is_agency_owner() and public.is_member(company_id) and exists(select 1 from public.members where company_id=hermes_connections.company_id and person_id=auth.uid() and role='owner' and removed_at is null))
);
create policy hermes_create on public.hermes_connections for insert to authenticated with check (public.agency_access() and agency_owner_id=auth.uid());
create policy hermes_replace on public.hermes_connections for update to authenticated using (public.agency_access() and agency_owner_id=auth.uid()) with check (public.agency_access() and agency_owner_id=auth.uid());
create policy hermes_remove on public.hermes_connections for delete to authenticated using (public.agency_access() and agency_owner_id=auth.uid());
revoke all on public.hermes_connections from anon,authenticated,service_role;
grant select(id,company_id,agency_owner_id,address,profile,state,version,features,unreachable_since) on public.hermes_connections to authenticated;
grant insert on public.hermes_connections to authenticated;
grant update(address,profile,key_encrypted,state,version,features,unreachable_since),delete on public.hermes_connections to authenticated;
grant select(id,agency_owner_id,key_encrypted) on public.hermes_connections to service_role;
