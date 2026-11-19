-- #378 (T3), ADR 0018: a Company names its Engine in `companies.engine_id` alone. The record used to name the Company
-- too, and a trigger kept the two links in step; two links meant two truths, read inconsistently. The column and the
-- trigger go, and the one link keeps what matters: no Company ends a transaction without an Engine, and one Engine
-- record serves one Company. Waiting records are those no Company names.
drop trigger if exists attach_company_engine on public.companies;
drop function if exists public.attach_company_engine();
alter table public.company_engines drop column company_id;
-- One Engine serves one Company. The column is nullable, so waiting records (no Company) are not compared.
alter table public.companies add constraint companies_engine_unique unique (engine_id);

-- The check runs at commit, so a flow that names the record in a later statement of the same transaction is allowed.
create or replace function public.company_needs_engine() returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if new.engine_id is null or not exists(select 1 from public.company_engines e where e.id=new.engine_id) then
  raise exception 'companyEngineMissing' using errcode='55000';
 end if;
 return new;
end $function$;
revoke all on function public.company_needs_engine() from public,anon,authenticated,service_role;

-- First run names the one record waiting for it: a record no Company names.
create or replace function public.complete_setup(person uuid, person_name text, company_name text, language text) returns text language plpgsql security definer set search_path='' as $$
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
 update public.setup_claim set closed=true where singleton;
 return slug;
end $$;

-- A Company made with its Owner names a record no Company names, and the only Company that record serves is the one
-- this transaction writes.
create or replace function public.create_company_with_owner(engine uuid, company_name text, person uuid, person_name text, language text, slug text default null)
returns text language plpgsql security definer set search_path='' as $function$
declare company uuid:=gen_random_uuid(); made text;
begin
 if person is null or engine is null then raise exception 'invalidOwner' using errcode='22023'; end if;
 if company_name is null or length(trim(company_name)) not between 1 and 120 then raise exception 'invalidCompany' using errcode='22023'; end if;
 perform 1 from public.company_engines e where e.id=engine and not exists(select 1 from public.companies c where c.engine_id=e.id) for update;
 if not found then raise exception 'companyEngineUnknown' using errcode='55000'; end if;
 if not exists(select 1 from public.people p where p.id=person) then
  if person_name is null or length(trim(person_name)) not between 1 and 120 or language is null or language not in ('en','ar') then
   raise exception 'invalidOwner' using errcode='22023';
  end if;
  insert into public.people(id,name,language) values(person,trim(person_name),language);
 end if;
 if slug is null or slug='' then
  made:=coalesce(nullif(trim(both '-' from regexp_replace(lower(company_name),'[^a-z0-9]+','-','g')),''),'company') || '-' || left(company::text,8);
 else
  if slug !~ '^[a-z0-9-]{1,80}$' then raise exception 'invalidCompanySlug' using errcode='22023'; end if;
  made:=slug;
 end if;
 insert into public.companies(id,slug,name,work_mode,engine_id) values(company,made,trim(company_name),null,engine);
 insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) values(company,person,'owner',true,true,true);
 return made;
end $function$;
revoke all on function public.create_company_with_owner(uuid,text,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_company_with_owner(uuid,text,uuid,text,text,text) to service_role;

-- The installer's adoption writes the record and names it on the one Company that has none, in one transaction.
create or replace function public.adopt_engine(address text, key_encrypted text) returns uuid
language plpgsql security definer set search_path='' as $function$
declare missing integer; engine uuid;
begin
 if address is null or length(address) not between 1 and 2048 or key_encrypted is null or length(key_encrypted)=0 then
  raise exception 'invalidEngine' using errcode='22023';
 end if;
 select count(*) into missing from public.companies c where c.engine_id is null;
 if missing=0 then return null; end if;
 if missing>1 then raise exception 'companyEngineMissing' using errcode='55000'; end if;
 insert into public.company_engines(address,key_encrypted) values(address,key_encrypted) returning id into engine;
 update public.companies set engine_id=engine where engine_id is null;
 return engine;
end $function$;
revoke all on function public.adopt_engine(text,text) from public,anon,authenticated,service_role;
grant execute on function public.adopt_engine(text,text) to service_role;
