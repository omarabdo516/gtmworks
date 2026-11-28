-- #953, ADR 0019, the cutover (ADR 0023): the release this one replaced has stopped serving, so the email invitation
-- path leaves for good. Every invitation still pending is ended, the Team table reads it as ended and makes an Invite
-- link for that Person instead; the table takes no write from a Member and the maker refuses. The release replaced never
-- reaches this step: scripts/install.sh applies it once this release's app and worker answer, and a failed update leaves
-- that release serving on the first step's schema (20270426000000_email_invitations_end.sql).
--
-- The table and its functions stay because the earlier migrations' checks hold their shape, the ended rows are read
-- once, and the channel invitee rows a Company already holds keep their foreign key; they leave with Channels (#921).

-- A cutover never lands in the transaction that applied its first step. An installer from before ADR 0023 applies every
-- migration in one transaction before it starts anything: it fails here, the whole transaction rolls back, and the
-- release it runs keeps serving on the schema it was built for.
do $$ begin
 if to_regclass('gtmworks_install.schema_migrations') is not null then
  if exists(select 1 from gtmworks_install.schema_migrations m where m.name='20270426000000_email_invitations_end.sql' and m.xmin=pg_current_xact_id()::xid) then
   raise exception 'This update is finished by the installer it downloaded: run sh scripts/install.sh update again. The database and the running release were not changed.';
  end if;
 end if;
end $$;

-- Settled again here for an invitation the previous release wrote between the two steps, and for a backup from before
-- this step restored onto this release.
update public.member_invitations set ended_at=now() where claimed_at is null and ended_at is null;

-- An email invitation is made and changed by no Member any more; an Administrator only reads the ended rows. The
-- policies stay (20270417100000_owner_guard.verify.sql reads them), while the table's writes are gone.
revoke all on public.member_invitations from anon, authenticated;
grant select on public.member_invitations to authenticated;

-- The email invitation maker refuses: the app calls make_invite_link instead (#950), and an old caller writes nothing.
create or replace function public.invite_member(c uuid, mail text, member_role text, check_only boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 raise exception 'inviteEmailRetired' using errcode='42501';
end $$;


-- The legacy role-agents cutover (20270418000001) redefines the claim and the owner guard when the installer applies every
-- cutover after the normal migrations; this cutover sorts after it and keeps the ended checks in the final shape.
create or replace function public.claim_invitations() returns void language plpgsql security definer set search_path = '' as $$
declare inv public.member_invitations; mail text; joined boolean;
begin
 select email into mail from auth.users where id=auth.uid();
 if mail is null then return; end if;
 insert into public.people(id,name) values(auth.uid(),split_part(mail,'@',1)) on conflict(id) do nothing;
 for inv in select * from public.member_invitations where lower(email)=lower(mail) and claimed_at is null and ended_at is null for update loop
  joined := false;
  insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) values(inv.company_id,auth.uid(),inv.role,inv.grant_publishing,inv.grant_money_figures,inv.grant_customer_data) on conflict (company_id,person_id) do update set role=excluded.role, grant_publishing=excluded.grant_publishing, grant_money_figures=excluded.grant_money_figures, grant_customer_data=excluded.grant_customer_data, removed_at=null where public.members.removed_at is not null
   returning true into joined;
  if joined then
   delete from public.member_agent_access where company_id=inv.company_id and person_id=auth.uid();
   insert into public.member_agent_access(company_id,person_id,agent_id)
    select inv.company_id,auth.uid(),a.agent_id from public.invitation_agent_access a where a.invitation_id=inv.id
    on conflict do nothing;
  end if;
  insert into public.channel_people(channel_id, company_id, person_id, joined_through, added_by)
   select i.channel_id, i.company_id, auth.uid(), coalesce((select max(m.id) from public.channel_messages m where m.channel_id=i.channel_id),0), i.added_by
   from public.channel_invitees i where i.invitation_id=inv.id
   on conflict (channel_id, person_id) do nothing;
  delete from public.channel_invitees where invitation_id=inv.id;
  delete from public.invitation_agent_access where invitation_id=inv.id;
  update public.member_invitations set claimed_at=now() where id=inv.id;
 end loop;
end $$;

create or replace function public.guard_member() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'DELETE' then raise exception 'members must be removed by updating removed_at'; end if;
 if tg_op = 'UPDATE' and (new.company_id <> old.company_id or new.person_id <> old.person_id) then raise exception 'membership identity cannot change'; end if;
 if auth.uid() is not null then
  -- A signed-in person's write (the request's role), however it reaches the row: the database's own maintenance is not
  -- a person changing a Member.
  if tg_op = 'UPDATE' and current_setting('role', true) = 'authenticated' and old.removed_at is null and not public.is_company_owner(old.company_id) then
   if old.role = 'owner' and (new.role, new.grant_publishing, new.grant_money_figures, new.grant_customer_data, new.removed_at)
      is distinct from (old.role, old.grant_publishing, old.grant_money_figures, old.grant_customer_data, old.removed_at) then
    raise exception 'ownerChangedByOwnerOnly' using errcode = '42501';
   end if;
   if old.person_id = auth.uid() and (new.role, new.grant_publishing, new.grant_money_figures, new.grant_customer_data)
      is distinct from (old.role, old.grant_publishing, old.grant_money_figures, old.grant_customer_data) then
    raise exception 'ownGrantsUnchangeable' using errcode = '42501';
   end if;
  end if;
  if new.role = 'owner' and (tg_op = 'INSERT' or old.role <> 'owner' or old.removed_at is not null) and not public.can_assign_owner(new.company_id) and not exists(select 1 from public.member_invitations where company_id=new.company_id and role='owner' and claimed_at is null and ended_at is null and lower(email)=lower((select email from auth.users where id=auth.uid()))) then raise exception 'only an owner can assign owner'; end if;
  if tg_op <> 'INSERT' and old.role = 'owner' and old.removed_at is null and (new.role <> 'owner' or new.removed_at is not null) then
   perform pg_advisory_xact_lock(hashtextextended(old.company_id::text,0));
   if (select count(*) from public.members where company_id=old.company_id and role='owner' and removed_at is null) <= 1 then raise exception 'last owner cannot be removed or demoted'; end if;
  end if;
 end if;
 return new;
end $$;
