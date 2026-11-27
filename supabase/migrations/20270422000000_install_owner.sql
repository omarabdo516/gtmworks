-- #915 (decision 0081): the install owner's account. The Engine's own dashboard is the install owner's alone, for rare
-- technical pages such as its logs; every other Administrator reaches settings only through gtmworks's own screens.
-- The install owner is the account first-run made with the setup code only the server's holder has (GLOSSARY: Install
-- owner). A Company made later gets its first Administrator from a first-Administrator link, and that person is not it.
-- No role of the app reads or writes this row: a person asks only whether they are it, through is_install_owner.
create table public.install_owner (
 singleton boolean primary key default true check(singleton),
 person_id uuid not null references public.people(id) on delete cascade
);
alter table public.install_owner enable row level security;
revoke all on public.install_owner from public, anon, authenticated, service_role;

-- An install set up before this: first-run made the install's first account, so the earliest person is the install owner.
insert into public.install_owner(person_id)
select p.id from public.people p join auth.users u on u.id=p.id order by u.created_at, u.id limit 1;

create function public.is_install_owner() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.install_owner where person_id=auth.uid());
$$;
revoke all on function public.is_install_owner() from public, anon, service_role;
grant execute on function public.is_install_owner() to authenticated;

-- First-run records the account it makes as the install owner.
create or replace function public.complete_setup(person uuid, person_name text, company_name text, language text) returns text
 language plpgsql security definer set search_path='' as $$
declare company uuid:=gen_random_uuid(); slug text; engine uuid;
begin
 perform pg_advisory_xact_lock(238, 1);
 if not public.setup_is_open() then raise exception 'Setup closed'; end if;
 if length(trim(person_name)) not between 1 and 120 or length(trim(company_name)) not between 1 and 120 or language not in ('en','ar') or person_name is null or company_name is null or language is null then raise exception 'Invalid setup'; end if;
 select e.id into engine from public.company_engines e
  where not exists(select 1 from public.companies c where c.engine_id=e.id)
  order by e.created_at,e.id limit 1 for update;
 if engine is null then raise exception 'companyEngineMissing' using errcode='55000'; end if;
 slug:=coalesce(nullif(trim(both '-' from regexp_replace(lower(company_name),'[^a-z0-9]+','-','g')),''),'company') || '-' || left(company::text,8);
 insert into public.people(id,name,language) values(person,person_name,language);
 insert into public.companies(id,slug,name,work_mode,engine_id) values(company,slug,company_name,null,engine);
 insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) values(company,person,'owner',true,true,true);
 insert into public.install_owner(person_id) values(person) on conflict (singleton) do update set person_id=excluded.person_id;
 update public.setup_claim set closed=true where singleton;
 return slug;
end $$;
