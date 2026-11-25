-- #682 (spec #668, ADR 0026): a Card waits for other Cards. Each side shows the other; the tile shows how many it still
-- waits for. A wait is released when the Card waited for is Live or Done, or archived: archiving releases it for good, so
-- a Card restored makes nobody wait again. A loop of waits is refused in the database. A Card waited for that the reader
-- may not see shows only as a hidden Card. Only adds (ADR 0023): the previous release never reads it.

create table public.work_card_waits(
 company_id uuid not null,
 card_id bigint not null,
 waits_for bigint not null,
 released_at timestamptz,
 created_by uuid references public.people(id) on delete set null,
 created_at timestamptz not null default now(),
 primary key (card_id,waits_for),
 foreign key (company_id,card_id) references public.work_cards(company_id,id) on delete cascade,
 foreign key (company_id,waits_for) references public.work_cards(company_id,id) on delete cascade,
 check (card_id<>waits_for)
);
create index work_card_waits_for on public.work_card_waits(company_id,waits_for);
alter table public.work_card_waits enable row level security;
revoke all on public.work_card_waits from anon,authenticated;
grant select on public.work_card_waits to authenticated;
create policy work_read on public.work_card_waits for select to authenticated using (public.is_member(company_id));
create policy card_agent_visible on public.work_card_waits as restrictive for select to authenticated using (public.can_see_card(company_id,card_id));

-- 1. No loop: a Card never waits, through any chain, for itself. Writes are taken one at a time per Company, so two that
-- would close a loop together cannot both pass.
create function public.refuse_wait_loop()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('work_card_waits:'||new.company_id::text,0));
 if exists(with recursive reach(id) as (
   select new.waits_for
   union
   select w.waits_for from public.work_card_waits w join reach r on w.card_id=r.id where w.company_id=new.company_id)
  select 1 from reach where id=new.card_id) then
  raise exception 'wait loop' using errcode='P0001';
 end if;
 return new;
end $$;
revoke all on function public.refuse_wait_loop() from public,anon,authenticated,service_role;
create trigger work_card_waits_no_loop before insert or update on public.work_card_waits for each row execute function public.refuse_wait_loop();

-- 2. Archiving a Card releases every wait on it for good.
create function public.release_waits_on_archive()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.archived_at is not null and old.archived_at is null then
  update public.work_card_waits w set released_at=now() where w.company_id=new.company_id and w.waits_for=new.id and w.released_at is null;
 end if;
 return null;
end $$;
revoke all on function public.release_waits_on_archive() from public,anon,authenticated,service_role;
create trigger work_cards_release_waits after update of archived_at on public.work_cards for each row execute function public.release_waits_on_archive();

-- Whether a wait still holds: not released, and the Card waited for neither Live, Done nor archived.
create function public.wait_open(w public.work_card_waits)
returns boolean language sql stable security definer set search_path='' as $$
 select w.released_at is null and exists(select 1 from public.work_cards x where x.company_id=w.company_id and x.id=w.waits_for and x.archived_at is null and x.status not in ('live','done'));
$$;
revoke all on function public.wait_open(public.work_card_waits) from public,anon,authenticated,service_role;

-- 3. Wait for another Card, or stop waiting: anyone who may edit the Company's work, on current Cards they see.
create function public.add_card_wait(c uuid, card bigint, waits_for bigint)
returns void language plpgsql security definer set search_path='' as $$
declare target text; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.work_cards x where x.company_id=c and x.id=card and x.archived_at is null) or not public.can_see_card(c,card) then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 select x.title into target from public.work_cards x where x.company_id=c and x.id=waits_for and x.archived_at is null;
 if target is null or not public.can_see_card(c,waits_for) then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 if card=waits_for then raise exception 'wait loop' using errcode='P0001'; end if;
 insert into public.work_card_waits(company_id,card_id,waits_for,created_by) values(c,card,waits_for,auth.uid()) on conflict do nothing;
 if found then insert into public.work_activity(company_id,card_id,actor_id,action,details) values(c,card,auth.uid(),'wait_added',jsonb_build_object('waits_for',waits_for,'title',target)); end if;
end $$;
revoke all on function public.add_card_wait(uuid,bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function public.add_card_wait(uuid,bigint,bigint) to authenticated;

create function public.remove_card_wait(c uuid, card bigint, waits_for bigint)
returns void language plpgsql security definer set search_path='' as $$
declare target text; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 if not exists(select 1 from public.work_cards x where x.company_id=c and x.id=card and x.archived_at is null) or not public.can_see_card(c,card) then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 delete from public.work_card_waits w where w.company_id=c and w.card_id=card and w.waits_for=remove_card_wait.waits_for;
 if found then
  select case when public.can_see_card(c,remove_card_wait.waits_for) then x.title end into target from public.work_cards x where x.company_id=c and x.id=remove_card_wait.waits_for;
  insert into public.work_activity(company_id,card_id,actor_id,action,details) values(c,card,auth.uid(),'wait_removed',jsonb_build_object('waits_for',waits_for,'title',target));
 end if;
end $$;
revoke all on function public.remove_card_wait(uuid,bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function public.remove_card_wait(uuid,bigint,bigint) to authenticated;

-- 4. Both sides of one Card the reader sees: the Cards it waits for and those waiting for it, each with whether the wait
-- still holds. A Card on the other side the reader may not see is named by nothing (a hidden Card); one waiting for it
-- that the reader may not see is left out.
create function public.card_wait_links(c uuid, card bigint)
returns table(side text, other bigint, title text, status text, open boolean)
language sql stable security definer set search_path='' as $$
 select 'waits_for', w.waits_for, case when public.can_see_card(c,w.waits_for) then x.title end,
   case when public.can_see_card(c,w.waits_for) then case when x.archived_at is not null then 'archived' else x.status end end, public.wait_open(w)
  from public.work_card_waits w join public.work_cards x on x.company_id=w.company_id and x.id=w.waits_for
  where w.company_id=c and w.card_id=card and public.is_member(c) and public.can_see_card(c,card)
 union all
 select 'waited_by', w.card_id, x.title, case when x.archived_at is not null then 'archived' else x.status end, public.wait_open(w)
  from public.work_card_waits w join public.work_cards x on x.company_id=w.company_id and x.id=w.card_id
  where w.company_id=c and w.waits_for=card and public.is_member(c) and public.can_see_card(c,card) and public.can_see_card(c,w.card_id) and x.archived_at is null
 order by 1, 2;
$$;
revoke all on function public.card_wait_links(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.card_wait_links(uuid,bigint) to authenticated;

-- 5. How many Cards each current Card the reader sees still waits for, hidden ones counted: the number on its tile.
create function public.open_card_waits(c uuid)
returns table(card_id bigint, waiting integer)
language sql stable security definer set search_path='' as $$
 select w.card_id, count(*)::integer from public.work_card_waits w
  join public.work_cards x on x.company_id=w.company_id and x.id=w.card_id and x.archived_at is null
  where w.company_id=c and public.is_member(c) and public.can_see_card(c,w.card_id) and public.wait_open(w)
  group by w.card_id;
$$;
revoke all on function public.open_card_waits(uuid) from public,anon,authenticated,service_role;
grant execute on function public.open_card_waits(uuid) to authenticated;
