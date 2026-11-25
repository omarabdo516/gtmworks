-- #774 and #775 (spec #760; Omar, 2026-11-25, vault decision 0071; GLOSSARY.md Owner and Grant).
--
-- Only an Owner changes or removes an Owner, and a Manager never changes their own Role or Grants. The guard on members
-- refuses both whichever way the row is written: remove_member, the members page's update, or the row written directly.
-- The guards it already had stay as they were: only an Owner makes an Owner, and a Company keeps one Owner. Leaving a
-- Company (one's own removed_at) and joining again through an invitation (a removed row) are not changes of one's
-- own Role or Grants.
--
-- An invitation is made only by a person who may invite, an Owner, whichever way it is called: the app calls invite_member
-- alone, which checks the Owner, and the policies that let a Manager write the invitation row directly are narrowed to an
-- Owner. claim_invitations already leaves an active Member's row as it is (its update is only for a removed row) and stays.
--
-- Narrowing, and only for what a Manager should not do (ADR 0023 needs no cutover): the previous app version's members
-- page refuses a Manager's change of an Owner or of their own row, and a Manager's invitation, with its error line; its
-- Owner's invitation and every other change work as before.

create or replace function public.guard_member() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'DELETE' then raise exception 'members must be removed by updating removed_at'; end if;
 if tg_op = 'UPDATE' and (new.company_id <> old.company_id or new.person_id <> old.person_id) then raise exception 'membership identity cannot change'; end if;
 if auth.uid() is not null then
  -- A signed-in person's write (the request's role), however it reaches the row: the database's own maintenance is not
  -- a person changing a Member.
  if tg_op = 'UPDATE' and current_setting('role', true) = 'authenticated' and old.removed_at is null and not public.is_company_owner(old.company_id) then
   if old.role = 'owner' and (new.role, new.agent_role, new.grant_publishing, new.grant_money_figures, new.grant_customer_data, new.removed_at)
      is distinct from (old.role, old.agent_role, old.grant_publishing, old.grant_money_figures, old.grant_customer_data, old.removed_at) then
    raise exception 'ownerChangedByOwnerOnly' using errcode = '42501';
   end if;
   if old.person_id = auth.uid() and (new.role, new.agent_role, new.grant_publishing, new.grant_money_figures, new.grant_customer_data)
      is distinct from (old.role, old.agent_role, old.grant_publishing, old.grant_money_figures, old.grant_customer_data) then
    raise exception 'ownGrantsUnchangeable' using errcode = '42501';
   end if;
  end if;
  if new.role = 'owner' and (tg_op = 'INSERT' or old.role <> 'owner' or old.removed_at is not null) and not public.can_assign_owner(new.company_id) and not exists(select 1 from public.member_invitations where company_id=new.company_id and role='owner' and claimed_at is null and lower(email)=lower((select email from auth.users where id=auth.uid()))) then raise exception 'only an owner can assign owner'; end if;
  if tg_op <> 'INSERT' and old.role = 'owner' and old.removed_at is null and (new.role <> 'owner' or new.removed_at is not null) then
   perform pg_advisory_xact_lock(hashtextextended(old.company_id::text,0));
   if (select count(*) from public.members where company_id=old.company_id and role='owner' and removed_at is null) <= 1 then raise exception 'last owner cannot be removed or demoted'; end if;
  end if;
 end if;
 return new;
end $$;

alter policy invitation_insert on public.member_invitations with check (public.is_company_owner(company_id));
alter policy invitation_update on public.member_invitations using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));
