alter table public.members add column removed_at timestamptz;
create or replace function public.is_member(target_company uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists (select 1 from public.members where company_id=target_company and person_id=auth.uid() and removed_at is null);
$$;
create policy active_member_read on public.members as restrictive for select to authenticated using (removed_at is null);
create function public.is_agency_owner() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.people where id = auth.uid() and agency_owner);
$$;
create function public.agency_access() returns boolean language sql stable security definer set search_path = '' as $$
 select public.is_agency_owner() and coalesce(auth.jwt()->>'aal','') = 'aal2';
$$;
create function public.can_manage_company(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select public.agency_access() or exists(select 1 from public.members where company_id=target and person_id=auth.uid() and removed_at is null and role in ('owner','manager'));
$$;
create function public.can_assign_owner(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select public.agency_access() or exists(select 1 from public.members where company_id=target and person_id=auth.uid() and removed_at is null and role='owner');
$$;
create policy company_agency_read on public.companies for select to authenticated using (public.agency_access());
create policy member_agency_read on public.members for select to authenticated using (public.agency_access());
create policy people_team_read on public.people for select to authenticated using (exists(select 1 from public.members m where m.person_id=people.id and (public.is_member(m.company_id) or public.agency_access())));
create policy member_insert on public.members for insert to authenticated with check (public.can_manage_company(company_id));
create policy member_update on public.members for update to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
create policy member_delete on public.members for delete to authenticated using (public.can_manage_company(company_id));
create table public.member_audit (id bigint generated always as identity primary key, company_id uuid not null references public.companies(id), actor_id uuid references public.people(id), actor_name text, person_id uuid not null, person_name text, action text not null, before_data jsonb, after_data jsonb, created_at timestamptz not null default now());
alter table public.member_audit enable row level security;
create policy audit_read on public.member_audit for select to authenticated using (public.is_member(company_id) or public.agency_access());
create table public.member_invitations (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), email text not null, role public.member_role not null, grant_publishing boolean not null default false, grant_money_figures boolean not null default false, grant_customer_data boolean not null default false, created_at timestamptz not null default now(), claimed_at timestamptz, unique(company_id,email));
alter table public.member_invitations enable row level security;
create policy invitation_read on public.member_invitations for select to authenticated using (public.can_manage_company(company_id));
create policy invitation_insert on public.member_invitations for insert to authenticated with check (public.can_manage_company(company_id) and (role <> 'owner' or public.can_assign_owner(company_id)));
create policy invitation_update on public.member_invitations for update to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id) and (role <> 'owner' or public.can_assign_owner(company_id)));
create function public.guard_member() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'DELETE' then raise exception 'members must be removed by updating removed_at'; end if;
 if tg_op = 'UPDATE' and (new.company_id <> old.company_id or new.person_id <> old.person_id) then raise exception 'membership identity cannot change'; end if;
 if auth.uid() is not null then
  if tg_op <> 'DELETE' and new.role = 'owner' and (tg_op = 'INSERT' or old.role <> 'owner' or old.removed_at is not null) and not public.can_assign_owner(new.company_id) and not exists(select 1 from public.member_invitations where company_id=new.company_id and role='owner' and claimed_at is null and lower(email)=lower((select email from auth.users where id=auth.uid()))) then raise exception 'only an owner can assign owner'; end if;
  if tg_op <> 'INSERT' and old.role = 'owner' and old.removed_at is null and (new.role <> 'owner' or new.removed_at is not null) then
   perform pg_advisory_xact_lock(hashtextextended(old.company_id::text,0));
   if (select count(*) from public.members where company_id=old.company_id and role='owner' and removed_at is null) <= 1 then raise exception 'last owner cannot be removed or demoted'; end if;
  end if;
 end if;
 if tg_op = 'DELETE' then return old; end if; return new;
end $$;
create trigger member_guard before insert or update or delete on public.members for each row execute function public.guard_member();
create function public.audit_member() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.member_audit(company_id,actor_id,actor_name,person_id,person_name,action,before_data,after_data) values (coalesce(new.company_id,old.company_id),auth.uid(),(select name from public.people where id=auth.uid()),coalesce(new.person_id,old.person_id),(select name from public.people where id=coalesce(new.person_id,old.person_id)),case when tg_op = 'UPDATE' and old.removed_at is null and new.removed_at is not null then 'DELETE' else tg_op end,case when tg_op <> 'INSERT' then to_jsonb(old) end,case when tg_op <> 'DELETE' then to_jsonb(new) end);
 return coalesce(new,old);
end $$;
create trigger member_audit_trigger after insert or update or delete on public.members for each row execute function public.audit_member();
create function public.remove_member(target_company uuid, target_person uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.can_manage_company(target_company) then raise exception 'not permitted to remove members'; end if;
 update public.members set removed_at=now() where company_id=target_company and person_id=target_person and removed_at is null;
end $$;
revoke all on function public.remove_member(uuid,uuid) from public;
grant execute on function public.remove_member(uuid,uuid) to authenticated;
create function public.claim_invitations() returns void language plpgsql security definer set search_path = '' as $$
declare inv public.member_invitations; mail text;
begin
 select email into mail from auth.users where id=auth.uid();
 if mail is null then return; end if;
 insert into public.people(id,name) values(auth.uid(),split_part(mail,'@',1)) on conflict(id) do nothing;
 for inv in select * from public.member_invitations where lower(email)=lower(mail) and claimed_at is null for update loop
  insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) values(inv.company_id,auth.uid(),inv.role,inv.grant_publishing,inv.grant_money_figures,inv.grant_customer_data) on conflict (company_id,person_id) do update set role=excluded.role, grant_publishing=excluded.grant_publishing, grant_money_figures=excluded.grant_money_figures, grant_customer_data=excluded.grant_customer_data, removed_at=null where public.members.removed_at is not null;
  update public.member_invitations set claimed_at=now() where id=inv.id;
 end loop;
end $$;
revoke all on function public.claim_invitations() from public;
grant execute on function public.claim_invitations() to authenticated;
