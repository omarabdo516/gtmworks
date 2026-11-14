begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
-- Nobody outside a Company's Members enters it (ADR 0012): a signed-in person who is not a Member, even one with a
-- two-step verified session, reads no row of any Company table. Every public table but the shared ones carries
-- company_id (foundation.sql), so the list below is every Company table, found rather than written out.
insert into auth.users(id,email) values ('a7000000-0000-0000-0000-000000000001','outsider@example.com');
insert into public.people(id,name) values ('a7000000-0000-0000-0000-000000000001','Outsider');
-- Rows the caller can read, per Company table; rows of the excluded company are not counted.
create function public.readable_company_rows(excluded uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t text; n bigint; seen jsonb:='{}';
begin
 for t in select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
  where s.nspname='public' and c.relkind in ('r','p') and a.attname='company_id' and not a.attisdropped order by 1 loop
  if has_any_column_privilege(format('public.%I',t),'select') then
   execute format('select count(*) from public.%I where company_id is distinct from $1',t) into n using excluded;
  else n:=0; end if;
  seen:=seen||jsonb_build_object(t,n);
 end loop;
 select count(*) into n from public.companies where id is distinct from excluded; seen:=seen||jsonb_build_object('companies',n);
 select count(*) into n from public.people p where p.id<>auth.uid() and not exists(select 1 from public.members m where m.person_id=p.id and m.company_id=excluded); seen:=seen||jsonb_build_object('people (others)',n);
 select count(*) into n from storage.objects where bucket_id='creatives' and (excluded is null or name not like excluded::text||'/%'); seen:=seen||jsonb_build_object('creatives',n);
 return seen;
end $$;
grant execute on function public.readable_company_rows(uuid) to authenticated;
select is((select count(*)::int from jsonb_object_keys(public.readable_company_rows())),
 (select count(*)::int+3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and c.relname not in ('agents','companies','people','setup_claim')),
 'every Company table is checked');

set local role authenticated;
select set_config('request.jwt.claim.sub','a7000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a7000000-0000-0000-0000-000000000001","aal":"aal2"}',true);
select is((select string_agg(key||'='||value,',') from jsonb_each_text(public.readable_company_rows()) where value<>'0'),null,'a two-step verified person who is not a Member reads zero rows of every Company table');
select throws_ok($$select public.manage_hermes_agent('10000000-0000-0000-0000-000000000001','default',a=>'00000000-0000-0000-0000-000000000000')$$,'42501','hermesNotAllowed','a non-Member cannot manage a Company''s agents');
select ok(not public.conversation_can_write('10000000-0000-0000-0000-000000000001'),'a non-Member cannot talk to a Company''s agents');
select is((select count(*)::int from public.usage_by_day()),0,'a non-Member sees no usage');
select ok(not public.bundled_engine_shared('10000000-0000-0000-0000-000000000001'),'a non-Member is not told about the shared Engine');
select throws_ok($$insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state) values ('10000000-0000-0000-0000-000000000001',auth.uid(),'http://localhost','writer','ciphertext','connected')$$,'42501',null,'a non-Member cannot connect an Engine');

-- The same check sees rows when there are rows to see: the Owner of all three companies reads them.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"20000000-0000-0000-0000-000000000001","aal":"aal1"}',true);
select is((public.readable_company_rows()->>'companies')::int,3,'the Owner reads the companies they own, without two-step verification');
select ok((public.readable_company_rows()->>'work_cards')::int>0 and (public.readable_company_rows()->>'members')::int>0,'the Owner reads their companies'' rows');

-- A Member of one company reads nothing of another.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"20000000-0000-0000-0000-000000000003","aal":"aal2"}',true);
select is((select string_agg(key||'='||value,',') from jsonb_each_text(public.readable_company_rows('10000000-0000-0000-0000-000000000001')) where value<>'0'),null,'a Member of RS Learning reads zero rows of the other companies');
select ok((public.readable_company_rows()->>'work_cards')::int>0,'and still reads their own company');
reset role;

-- Nothing is left that could grant the bypass again.
select is((select string_agg(schemaname||'.'||tablename||'.'||policyname,',') from pg_policies where concat(qual,' ',with_check) ~ '(agency_access|is_agency_owner|agency_owner)'),null,'no policy references the Agency bypass');
select is((select string_agg(p.oid::regprocedure::text,',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','storage','auth') and p.prosrc ~ '(agency_access|is_agency_owner|agency_owner)'),null,'no function references the Agency bypass');
select ok(to_regprocedure('public.agency_access()') is null and to_regprocedure('public.is_agency_owner()') is null,'the Agency functions are gone');
select is((select string_agg(c.relname||'.'||a.attname,',') from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attname like 'agency%' and not a.attisdropped),null,'no column records Agency staff');
select is((select string_agg(e.enumlabel,',' order by e.enumsortorder) from pg_enum e where e.enumtypid='public.member_role'::regtype),'owner,manager,contributor,viewer','the Roles are Owner, Manager, Contributor and Viewer');
select is((select count(*)::int from pg_policies where policyname in ('company_agency_read','member_agency_read')),0,'the Agency read policies are gone');
select * from finish();
rollback;
