-- #382, ADR 0018: a Company is made attached to one explicitly named Engine record, never to whichever record happens to
-- be waiting. #380 claimed the oldest waiting row on every Company insert, so a Company could take the Engine another
-- Company was being made for (#383's first-Owner link and #382's named Owner could both leave a record waiting). Now the
-- Company names its Engine in `engine_id`; the insert attaches that record, and a deferred check refuses a Company that
-- ends its transaction with no Engine. One record serves one Company: naming a record another Company holds is refused.
alter table public.companies add column engine_id uuid references public.company_engines(id);
create index companies_engine_id on public.companies(engine_id);
-- An install made by #380 already has every Company's record: name each one, so its next write of the row passes the
-- check below and nothing stops working.
update public.companies c set engine_id=e.id from public.company_engines e where e.company_id=c.id and c.engine_id is null;

-- The after-insert attach now follows the Company's own `engine_id`, and releases a record when the id changes. A named
-- record must exist and must not already serve another Company.
create or replace function public.attach_company_engine() returns trigger language plpgsql security definer set search_path='' as $function$
declare held uuid;
begin
 if new.engine_id is null then return new; end if;
 select e.company_id into held from public.company_engines e where e.id=new.engine_id for update;
 if not found then raise exception 'companyEngineUnknown' using errcode='55000'; end if;
 if held is not null and held<>new.id then raise exception 'companyEngineTaken' using errcode='55000'; end if;
 update public.company_engines set company_id=new.id where id=new.engine_id;
 if tg_op='UPDATE' and old.engine_id is distinct from new.engine_id and old.engine_id is not null then
  update public.company_engines set company_id=null where id=old.engine_id and company_id=new.id;
 end if;
 return new;
end $function$;
revoke all on function public.attach_company_engine() from public,anon,authenticated,service_role;
drop trigger if exists attach_company_engine on public.companies;
create trigger attach_company_engine after insert or update of engine_id on public.companies for each row execute function public.attach_company_engine();

-- A Company with no Engine is still never made: the check runs at commit, so a flow that attaches the record in a later
-- statement of the same transaction (first run) is allowed, and a transaction that ends without one is refused whole.
create function public.company_needs_engine() returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if new.engine_id is null or not exists(select 1 from public.company_engines e where e.id=new.engine_id and e.company_id=new.id) then
  raise exception 'companyEngineMissing' using errcode='55000';
 end if;
 return new;
end $function$;
revoke all on function public.company_needs_engine() from public,anon,authenticated,service_role;
create constraint trigger company_needs_engine after insert or update of engine_id on public.companies
 deferrable initially deferred for each row execute function public.company_needs_engine();

-- First run (and only first run) attaches the Engine the installer registered: one waiting record names the first
-- Company. No record waiting means the installer did not finish; the setup is refused and nothing is written.
create or replace function public.complete_setup(person uuid, person_name text, company_name text, language text) returns text language plpgsql security definer set search_path='' as $$
declare company uuid:=gen_random_uuid(); slug text; engine uuid;
begin
 perform pg_advisory_xact_lock(238, 1);
 if not public.setup_is_open() then raise exception 'Setup closed'; end if;
 if length(trim(person_name)) not between 1 and 120 or length(trim(company_name)) not between 1 and 120 or language not in ('en','ar') or person_name is null or company_name is null or language is null then raise exception 'Invalid setup'; end if;
 select e.id into engine from public.company_engines e where e.company_id is null order by e.created_at,e.id limit 1 for update;
 if engine is null then raise exception 'companyEngineMissing' using errcode='55000'; end if;
 slug:=coalesce(nullif(trim(both '-' from regexp_replace(lower(company_name),'[^a-z0-9]+','-','g')),''),'company') || '-' || left(company::text,8);
 insert into public.people(id,name,language) values(person,person_name,language);
 insert into public.companies(id,slug,name,work_mode,engine_id) values(company,slug,company_name,null,engine);
 insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) values(company,person,'owner',true,true,true);
 update public.setup_claim set closed=true where singleton;
 return slug;
end $$;
