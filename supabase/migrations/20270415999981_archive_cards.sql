-- #670 (spec #667, ADR 0026): a Card is archived, never deleted. Archived is a time and a person on the Card; every row
-- written on it stays. A Member who may edit and sees the Card archives and restores it, one or several at once, through
-- the two functions below, so a direct call obeys the same rules as the board.
alter table public.work_cards add column archived_at timestamptz;
alter table public.work_cards add column archived_by uuid references public.people(id) on delete set null;
alter table public.work_cards add constraint work_cards_archived_by_archived check (archived_by is null or archived_at is not null);

-- Every read of current Cards made as the signed-in person leaves archived ones out: the board, the list, the calendar,
-- Home, recent Cards, Projects' counts, an Agent's tasks, Waiting on you and every count read the table under this
-- policy, the previous release's reads among them. An archived Card is read only through archived_cards below, and a
-- function that reads the table as its owner is decided in supabase/tests/archived_card_readers.sql.
create policy card_current on public.work_cards as restrictive for select to authenticated using (archived_at is null);

create index work_cards_archived on public.work_cards(company_id,archived_at desc) where archived_at is not null;

-- The archived Cards of a Company this Member sees, newest archived first: the board's archive list, a Card opened from
-- an old link, the log's titles. A Card hidden from the Member stays hidden; another Company's Member reads nothing.
create function public.archived_cards(c uuid) returns setof public.work_cards
language sql stable security definer set search_path='' as $$
 select w.* from public.work_cards w
 where w.company_id=c and w.archived_at is not null and public.is_member(c) and public.can_see_card(c,w.id)
 order by w.archived_at desc, w.id desc;
$$;
revoke all on function public.archived_cards(uuid) from public,anon,service_role;
grant execute on function public.archived_cards(uuid) to authenticated;

-- Archives the named Cards and answers the ones it archived. The Role is checked once for the call (a Viewer, or anyone
-- outside the Company, is refused); a Card that is not this Company's, is hidden from the caller or is already archived
-- is left out of the answer, so a caller archiving several at once (#672) is told which it could not. Each Card keeps
-- its column and place, so restoring puts it back where it was, and gains one Activity log row naming the column.
-- Each Card is archived in one step under its row lock: #671 stops its Runs and clears what waits on it there, before
-- it is marked, so nothing is left running or asking about an archived Card.
create function public.archive_cards(c uuid, cards bigint[]) returns setof bigint
language plpgsql security definer set search_path='' as $$
declare w public.work_cards; left_column text;
begin
 if auth.uid() is null or not public.work_can_edit(c) then raise exception 'cardArchiveNotAllowed' using errcode='42501'; end if;
 for w in select * from public.work_cards where company_id=c and id=any(cards) and archived_at is null order by id for update loop
  if not public.can_see_card(c,w.id) then continue; end if;
  select s.board_column into left_column from public.work_stages s where s.company_id=c and s.id=w.stage_id;
  update public.work_cards set archived_at=now(),archived_by=auth.uid() where company_id=c and id=w.id;
  insert into public.work_activity(company_id,card_id,actor_id,action,details)
   values(c,w.id,auth.uid(),'card_archived',jsonb_build_object('column',left_column));
  return next w.id;
 end loop;
end $$;
revoke all on function public.archive_cards(uuid,bigint[]) from public,anon,service_role;
grant execute on function public.archive_cards(uuid,bigint[]) to authenticated;

-- Restores the named archived Cards to the column they were in and answers the ones it restored, with the same checks.
-- Nothing starts: no Run, handover or wait comes back with the Card.
create function public.restore_cards(c uuid, cards bigint[]) returns setof bigint
language plpgsql security definer set search_path='' as $$
declare w public.work_cards; back_column text;
begin
 if auth.uid() is null or not public.work_can_edit(c) then raise exception 'cardRestoreNotAllowed' using errcode='42501'; end if;
 for w in select * from public.work_cards where company_id=c and id=any(cards) and archived_at is not null order by id for update loop
  if not public.can_see_card(c,w.id) then continue; end if;
  select s.board_column into back_column from public.work_stages s where s.company_id=c and s.id=w.stage_id;
  update public.work_cards set archived_at=null,archived_by=null where company_id=c and id=w.id;
  insert into public.work_activity(company_id,card_id,actor_id,action,details)
   values(c,w.id,auth.uid(),'card_restored',jsonb_build_object('column',back_column));
  return next w.id;
 end loop;
end $$;
revoke all on function public.restore_cards(uuid,bigint[]) from public,anon,service_role;
grant execute on function public.restore_cards(uuid,bigint[]) to authenticated;

-- A team channel's Card on the channel's head (#151) is a current Card: an archived one shows nothing there.
create or replace function public.channel_board_card(ch uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare k public.channels; w public.work_cards; s public.work_stages; right_now text; next_item text; total int; done int;
begin
 if ch is null or auth.uid() is null or not public.channel_member(ch,auth.uid()) then return null; end if;
 select * into k from public.channels where id=ch;
 if k.id is null then return null; end if;
 select * into w from public.work_cards where channel_id=ch and company_id=k.company_id and archived_at is null;
 if w.id is null or not public.can_see_agent(k.company_id,w.agent_id) then return null; end if;
 select * into s from public.work_stages where company_id=k.company_id and id=w.stage_id;
 right_now:=coalesce(s.board_column,'ideas');
 if right_now='waiting' then
  next_item:=coalesce(public.card_wait(w)->>'title',s.name);
 elsif right_now='progress' then
  select count(*),count(*) filter (where i.done) into total,done from public.work_checklist i
   where i.company_id=k.company_id and i.card_id=w.id;
  if total>0 then
   select i.title into next_item from public.work_checklist i
    where i.company_id=k.company_id and i.card_id=w.id and not i.done order by i.id limit 1;
  end if;
 end if;
 return jsonb_build_object('card',w.id,'title',w.title,'column',right_now,
  'line',coalesce(case when right_now='progress' and total>0 and next_item is not null then next_item||' · '||round(100.0*done/total)::int||'%'
   when right_now='progress' and total>0 then round(100.0*done/total)::int||'%'
   when right_now='waiting' then next_item else s.name end,''),
  'waiting',right_now='waiting');
end $$;
