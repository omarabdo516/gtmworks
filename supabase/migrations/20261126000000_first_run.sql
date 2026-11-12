-- Install-wide state: deleting product rows must never reopen setup.
create table public.setup_claim (singleton boolean primary key default true check(singleton), closed boolean not null);
insert into public.setup_claim(closed) select exists(select 1 from public.people);
alter table public.setup_claim enable row level security;
revoke all on public.setup_claim from public, anon, authenticated;

create function public.setup_is_open() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.setup_claim where not closed) and not exists(select 1 from public.people);
$$;
create function public.complete_setup(person uuid, person_name text, company_name text, language text) returns text language plpgsql security definer set search_path='' as $$
declare company uuid:=gen_random_uuid(); slug text;
begin
 perform pg_advisory_xact_lock(238, 1);
 if not public.setup_is_open() then raise exception 'Setup closed'; end if;
 if length(trim(person_name)) not between 1 and 120 or length(trim(company_name)) not between 1 and 120 or language not in ('en','ar') or person_name is null or company_name is null or language is null then raise exception 'Invalid setup'; end if;
 slug:=coalesce(nullif(trim(both '-' from regexp_replace(lower(company_name),'[^a-z0-9]+','-','g')),''),'company') || '-' || left(company::text,8);
 insert into public.people(id,name,agency_owner,language) values(person,person_name,true,language);
 insert into public.companies(id,slug,name) values(company,slug,company_name);
 insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) values(company,person,'owner',true,true,true);
 update public.setup_claim set closed=true where singleton;
 return slug;
end $$;
-- Hosted defaults grant functions directly as well as via PUBLIC.
revoke all on function public.setup_is_open(), public.complete_setup(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.setup_is_open(), public.complete_setup(uuid,text,text,text) to service_role;
