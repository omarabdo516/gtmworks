-- #10: a Company worked alone turns into a team the moment a second active Member exists (an accepted invitation,
-- a restored Member or one added directly); nothing else changes, so every Conversation, Card and log row stays as
-- it was. A team goes back to alone only once every other Member is gone; an unanswered Company (null) may still
-- answer alone. Nothing existing is rewritten, and the previous app version, which never sets work_mode outside
-- choose_work_mode, runs against this database unchanged.

create function public.member_turns_team() returns trigger language plpgsql security definer set search_path='' as $$
declare mode text;
begin
 -- The Company row is locked first so a concurrent switch to alone waits for this Member and then counts them.
 select work_mode into mode from public.companies where id=new.company_id for update;
 if mode='alone' and (select count(*) from public.members where company_id=new.company_id and removed_at is null)>1 then
  update public.companies set work_mode='team' where id=new.company_id;
 end if;
 return null;
end $$;
revoke all on function public.member_turns_team() from public,anon,authenticated,service_role;
create trigger member_turns_team after insert or update of removed_at on public.members for each row when (new.removed_at is null) execute function public.member_turns_team();

create function public.guard_alone_mode() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.work_mode='team' and new.work_mode='alone' and (select count(*) from public.members where company_id=new.id and removed_at is null)>1 then
  raise exception 'workModeTeamHasMembers' using errcode='P0001';
 end if;
 return new;
end $$;
revoke all on function public.guard_alone_mode() from public,anon,authenticated,service_role;
create trigger alone_mode_guard before update of work_mode on public.companies for each row execute function public.guard_alone_mode();
