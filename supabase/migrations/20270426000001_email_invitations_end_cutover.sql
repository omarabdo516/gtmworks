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
