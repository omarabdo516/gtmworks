-- #619 (spec #611; GLOSSARY: Provider): the Owner's order of the Company's Providers, and which of them is switched off.
-- A Provider is named as provider_names names it (#618): a subscription by the Engine's id for its credential pool entry,
-- a key by `key` beside its provider (lib/provider-names.mjs). The pinned Engine keeps a priority on each pool entry,
-- reordered only from its command line (v0.23.0 agent/credential_pool_admin.py move_entry, `hermes auth priority`), and
-- has no state for an entry that is held but not used, so gtmworks keeps both (ADR 0022: persisted here because the
-- Engine does not supply them). Switching a Provider off keeps its sign-in or key in the Engine untouched, so switching
-- it on again needs no new sign-in. No row means on, after every placed Provider in the Engine's own order; nothing here
-- is a credential.
--
-- Nothing existing is changed: a new table and two new functions, which the previous app version never reads.

create table public.provider_order (
 company_id uuid not null references public.companies(id) on delete cascade,
 provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
 account text not null check (account ~ '^[A-Za-z0-9_-]{1,64}$'),
 -- The Provider's place in the Company's list, from 0; null when the Owner's last order did not name it.
 place integer check (place between 0 and 63),
 enabled boolean not null default true,
 changed_by uuid references public.people(id) on delete set null,
 changed_at timestamptz not null default now(),
 primary key (company_id,provider,account)
);
alter table public.provider_order enable row level security;
-- Every Member of the Company reads the order and the switches (a Manager sees them read-only); nobody writes the table
-- but the two functions below.
create policy provider_order_members_read on public.provider_order for select to authenticated using (public.is_member(company_id));
revoke all on table public.provider_order from public,anon,authenticated,service_role;
grant select on table public.provider_order to authenticated;

-- The Owner puts the Company's Providers in order: `entries` is the whole list, first to last, as
-- [{"provider":…,"account":…},…]. A Provider it does not name loses its place and keeps its switch. Checked here for every
-- call: a Manager, any other Member and a person outside the Company change nothing.
create function public.order_providers(c uuid, entries jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'providerNotAllowed' using errcode='42501'; end if;
 if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) not between 1 and 64
  or exists(select 1 from jsonb_array_elements(entries) e where jsonb_typeof(e) is distinct from 'object'
   or coalesce(e->>'provider','') !~ '^[a-z0-9][a-z0-9._-]{0,63}$' or coalesce(e->>'account','') !~ '^[A-Za-z0-9_-]{1,64}$')
  or (select count(distinct (e->>'provider',e->>'account')) from jsonb_array_elements(entries) e)<>jsonb_array_length(entries) then
  raise exception 'providerOrderInvalid' using errcode='22023';
 end if;
 update public.provider_order p set place=null,changed_by=auth.uid(),changed_at=now()
  where p.company_id=c and p.place is not null
   and not exists(select 1 from jsonb_array_elements(entries) e where e->>'provider'=p.provider and e->>'account'=p.account);
 insert into public.provider_order(company_id,provider,account,place,changed_by)
  select c,e->>'provider',e->>'account',(n-1)::int,auth.uid() from jsonb_array_elements(entries) with ordinality as x(e,n)
  on conflict on constraint provider_order_pkey do update set place=excluded.place,changed_by=excluded.changed_by,changed_at=now()
   where provider_order.place is distinct from excluded.place;
end $$;
revoke all on function public.order_providers(uuid,jsonb) from public,anon,service_role;
grant execute on function public.order_providers(uuid,jsonb) to authenticated;

-- The Owner switches one Provider off, or on again. Its place stays. Answers the switch as kept.
create function public.switch_provider(c uuid, provider text, account text, turned_on boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'providerNotAllowed' using errcode='42501'; end if;
 if turned_on is null or coalesce(provider,'') !~ '^[a-z0-9][a-z0-9._-]{0,63}$' or coalesce(account,'') !~ '^[A-Za-z0-9_-]{1,64}$' then
  raise exception 'providerOrderInvalid' using errcode='22023';
 end if;
 insert into public.provider_order(company_id,provider,account,enabled,changed_by)
  values (c,switch_provider.provider,switch_provider.account,turned_on,auth.uid())
  on conflict on constraint provider_order_pkey do update set enabled=excluded.enabled,changed_by=excluded.changed_by,changed_at=now();
 return turned_on;
end $$;
revoke all on function public.switch_provider(uuid,text,text,boolean) from public,anon,service_role;
grant execute on function public.switch_provider(uuid,text,text,boolean) to authenticated;

-- A Provider the Owner removed takes its place and its switch with it, so a key given again, which is named `key` as the
-- removed one was, starts switched on at the end of the list.
create function public.forget_provider(c uuid, provider text, account text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'providerNotAllowed' using errcode='42501'; end if;
 delete from public.provider_order p where p.company_id=c and p.provider=forget_provider.provider and p.account=forget_provider.account;
end $$;
revoke all on function public.forget_provider(uuid,text,text) from public,anon,service_role;
grant execute on function public.forget_provider(uuid,text,text) to authenticated;
