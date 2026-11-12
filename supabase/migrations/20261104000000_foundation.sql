create type public.member_role as enum ('owner', 'manager', 'contributor', 'reviewer', 'viewer');
create table public.companies (id uuid primary key, slug text not null unique, name text not null);
create table public.people (id uuid primary key references auth.users(id), name text not null, agency_owner boolean not null default false);
create table public.members (company_id uuid not null references public.companies(id), person_id uuid not null references public.people(id), role public.member_role not null, grant_publishing boolean not null default false, grant_money_figures boolean not null default false, grant_customer_data boolean not null default false, primary key (company_id, person_id));
create table public.role_permissions (company_id uuid not null references public.companies(id), role public.member_role not null, permission text not null, allowed boolean not null default false, primary key (company_id, role, permission), constraint no_contributor_viewer_approval check (not (role in ('contributor','viewer') and permission in ('approve','reject') and allowed)));

alter table public.companies enable row level security;
alter table public.people enable row level security;
alter table public.members enable row level security;
alter table public.role_permissions enable row level security;
-- The helper avoids recursive membership policies; it only answers for the caller.
create function public.is_member(target_company uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where company_id = target_company and person_id = (select auth.uid()));
$$;
revoke all on function public.is_member(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated;
create policy company_read on public.companies for select to authenticated using (public.is_member(id));
create policy person_read on public.people for select to authenticated using (id = (select auth.uid()));
create policy member_read on public.members for select to authenticated using (public.is_member(company_id));
create policy permission_read on public.role_permissions for select to authenticated using (public.is_member(company_id));
