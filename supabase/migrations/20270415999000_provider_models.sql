-- #620 (spec #611): the models each of a Company's Providers offers, switched on or off by the Owner. The pinned Engine
-- keeps no model list per credential (v0.23.0 agent/credential_pool.py PooledCredential: model_cooldowns only, no
-- allow-list), so gtmworks keeps the switches (ADR 0022: persisted here because the Engine does not supply them). A row
-- is one switch of one Provider: `entry` is the Provider's id in the Providers list, `sub-<provider>` for a subscription
-- and `key-<provider>` for an API key, <provider> being the Engine's own provider id. No row means on, so every model a
-- Provider already offered stays offered until the Owner turns it off. Nothing here is a secret: a Provider is named by
-- its kind and provider id only.
create table public.company_provider_models (
 company_id uuid not null references public.companies(id) on delete cascade,
 entry text not null check (entry ~ '^(sub|key)-[a-z0-9][a-z0-9._-]{0,63}$'),
 model text not null check (model ~ '^[^\s/][^\s]{0,199}$'),
 enabled boolean not null,
 changed_by uuid references public.people(id) on delete set null,
 changed_at timestamptz not null default now(),
 primary key (company_id,entry,model)
);
-- Every Member of the Company reads its switches (a Manager sees them read-only); nobody writes the table directly.
alter table public.company_provider_models enable row level security;
revoke all on public.company_provider_models from anon,authenticated,service_role;
grant select on public.company_provider_models to authenticated;
create policy company_provider_models_read on public.company_provider_models for select to authenticated using (public.is_member(company_id));

-- The Owner, and only the Owner, turns one model of one Provider on or off. Answers the switch as kept.
create function public.set_provider_model(c uuid, provider_entry text, provider_model text, turned_on boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'providerModelNotAllowed' using errcode='42501'; end if;
 if turned_on is null or coalesce(provider_entry,'') !~ '^(sub|key)-[a-z0-9][a-z0-9._-]{0,63}$' or coalesce(provider_model,'') !~ '^[^\s/][^\s]{0,199}$' then
  raise exception 'providerModelInvalid' using errcode='22023';
 end if;
 insert into public.company_provider_models(company_id,entry,model,enabled,changed_by)
  values (c,provider_entry,provider_model,turned_on,auth.uid())
  on conflict (company_id,entry,model) do update set enabled=excluded.enabled,changed_by=excluded.changed_by,changed_at=now();
 return turned_on;
end $$;
revoke all on function public.set_provider_model(uuid,text,text,boolean) from public,anon,service_role;
grant execute on function public.set_provider_model(uuid,text,text,boolean) to authenticated;
