-- #618 (spec #611; GLOSSARY: Provider): the name the Owner gives each of the Company's Providers, so two subscriptions
-- of one kind, or a subscription and a key, read apart. A Provider is the Engine's: a subscription is one entry of the
-- root profile's credential pool, named here by the Engine's own entry id, and a key is named `key` beside its provider
-- (lib/provider-names.mjs). Only the name is kept; no credential, token preview or Engine label is. A Provider with no
-- row reads under its kind's own name.
--
-- Nothing existing is changed: a new table and a new function, which the previous app version never reads.

create table public.provider_names (
 company_id uuid not null references public.companies(id) on delete cascade,
 provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
 account text not null check (account ~ '^[A-Za-z0-9_-]{1,64}$'),
 name text not null check (name=btrim(name) and char_length(name) between 1 and 60 and name !~ '[[:cntrl:]]'),
 named_by uuid references public.people(id) on delete set null,
 named_at timestamptz not null default now(),
 primary key (company_id,provider,account)
);
alter table public.provider_names enable row level security;
-- Every Member of the Company reads its Providers' names; nobody writes the table but rename_provider.
create policy provider_names_members_read on public.provider_names for select to authenticated using (public.is_member(company_id));
revoke all on table public.provider_names from public,anon,authenticated,service_role;
grant select on table public.provider_names to authenticated;

-- The Owner names a Provider, or gives back its kind's name with an empty one. Checked here for every call: a Manager,
-- any other Member and a person outside the Company change nothing.
create function public.rename_provider(c uuid, provider text, account text, name text) returns void
language plpgsql security definer set search_path='' as $$
declare given text := btrim(coalesce(name,''));
begin
 if not public.is_company_owner(c) then raise exception 'providerNotAllowed' using errcode='42501'; end if;
 if coalesce(provider,'') !~ '^[a-z0-9][a-z0-9._-]{0,63}$' or coalesce(account,'') !~ '^[A-Za-z0-9_-]{1,64}$'
  or char_length(given)>60 or given ~ '[[:cntrl:]]' then
  raise exception 'providerNameInvalid' using errcode='22023';
 end if;
 if given='' then
  delete from public.provider_names p where p.company_id=c and p.provider=rename_provider.provider and p.account=rename_provider.account;
  return;
 end if;
 insert into public.provider_names(company_id,provider,account,name,named_by)
  values (c,rename_provider.provider,rename_provider.account,given,auth.uid())
  on conflict on constraint provider_names_pkey do update set name=excluded.name,named_by=excluded.named_by,named_at=now();
end $$;
revoke all on function public.rename_provider(uuid,text,text,text) from public,anon,service_role;
grant execute on function public.rename_provider(uuid,text,text,text) to authenticated;
