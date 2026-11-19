-- #383, ADR 0019: a Company made with no named Owner is held behind a first-Owner link whose secret sits after `#` in the
-- address, so only its hash is kept. The link is used up by sending the form, never by opening the page, and printing a
-- fresh link for a Company still waiting ends the earlier one (one link per waiting Engine). Until it is used the Company
-- exists nowhere: this table holds the name and the Engine record, never a companies row. Only server code reads it.
create table public.company_owner_links (
 id uuid primary key default gen_random_uuid(),
 engine_id uuid not null unique references public.company_engines(id) on delete cascade,
 company_name text not null check (length(trim(company_name)) between 1 and 120),
 secret_hash text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 claimed_at timestamptz
);
alter table public.company_owner_links enable row level security;
-- No policy and no grant to anon or authenticated: a Member's query reads no link and cannot tell one exists. The secret
-- itself is never a column here; only its hash is, so a copy of this table opens no link.
revoke all on public.company_owner_links from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.company_owner_links to service_role;

-- One Company is made attached to the Engine record it is being made on, together with its Owner member, in one
-- transaction (#383, closing #382's two separate inserts): a Company is never left for a moment with no Owner. The named
-- record must be waiting, so two Companies made at once never take the same Engine. The Owner's Person row is written
-- when the person is new (a first-Owner link); a named existing Person is its own row already. Returns the Company's slug.
create function public.create_company_with_owner(engine uuid, company_name text, person uuid, person_name text, language text, slug text default null)
returns text language plpgsql security definer set search_path='' as $function$
declare company uuid:=gen_random_uuid(); made text;
begin
 if person is null or engine is null then raise exception 'invalidOwner' using errcode='22023'; end if;
 if company_name is null or length(trim(company_name)) not between 1 and 120 then raise exception 'invalidCompany' using errcode='22023'; end if;
 perform 1 from public.company_engines e where e.id=engine and e.company_id is null for update;
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

-- Sending the first-Owner form spends its link: the Company named behind the link is made on that link's Engine record
-- with the person sending it as its Owner, and the link is marked used in the same transaction. A second send finds it
-- used and makes nothing. A link whose Company was made meanwhile finds its record taken and makes nothing either.
create function public.claim_company_owner_link(link_hash text, person uuid, person_name text, language text)
returns text language plpgsql security definer set search_path='' as $function$
declare link public.company_owner_links; slug text;
begin
 if link_hash is null or link_hash !~ '^[a-f0-9]{64}$' then raise exception 'ownerLinkInvalid' using errcode='55000'; end if;
 select l.* into link from public.company_owner_links l where l.secret_hash=link_hash for update;
 if not found or link.claimed_at is not null then raise exception 'ownerLinkUsed' using errcode='55000'; end if;
 slug:=public.create_company_with_owner(link.engine_id,link.company_name,person,person_name,language);
 update public.company_owner_links set claimed_at=now() where id=link.id;
 return slug;
end $function$;
revoke all on function public.claim_company_owner_link(text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_company_owner_link(text,uuid,text,text) to service_role;
