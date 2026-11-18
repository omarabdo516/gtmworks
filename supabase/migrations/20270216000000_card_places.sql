-- A Card keeps its place inside its column (#174). The board draws each column in one order that every Member sees, kept
-- in the database: a Card moved by drag or by Shift with Up or Down keeps the place it was given, and a Card made or
-- moved to a column with no place chosen goes to that column's end. "Waiting on you" keeps its own order, newest first
-- (ADR 0013), so its Cards are never placed by hand.
--
-- Nothing is rewritten: every Card keeps its stage, its column and the place the board showed it in today, so the
-- previous app version reads and moves Cards as before. The column has no default; a Card a caller inserts without a
-- place takes the end of its column from the trigger, which every caller runs, old app version included.

alter table public.work_cards add column board_order numeric;

-- Today's shown order: each column's Cards by their stage's position, and inside one stage the older Card first (the
-- order the board read them in).
update public.work_cards w set board_order=x.place from (
 select c.id, row_number() over (partition by c.company_id, s.board_column order by s.position, c.id) as place
 from public.work_cards c join public.work_stages s on s.company_id=c.company_id and s.id=c.stage_id) x
 where w.id=x.id;

-- A Card inserted without a place goes to the end of its column, and one whose stage carries it into another column does
-- too; a Card changing stage inside the same column keeps its place. place_work_card names the place itself, in a second
-- statement, once its Card has arrived.
create function public.work_card_place() returns trigger language plpgsql security definer set search_path='' as $$
declare arrived text; left_column text; begin
 if tg_op='INSERT' then
  if new.board_order is null then
   select s.board_column into arrived from public.work_stages s where s.company_id=new.company_id and s.id=new.stage_id;
   new.board_order=coalesce((select max(w.board_order) from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id
    where w.company_id=new.company_id and s.board_column=arrived),0)+1;
  end if;
 elsif new.stage_id is distinct from old.stage_id then
  select s.board_column into arrived from public.work_stages s where s.company_id=new.company_id and s.id=new.stage_id;
  select s.board_column into left_column from public.work_stages s where s.company_id=old.company_id and s.id=old.stage_id;
  if arrived is distinct from left_column then
   new.board_order=coalesce((select max(w.board_order) from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id
    where w.company_id=new.company_id and s.board_column=arrived and w.id<>new.id),0)+1;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.work_card_place() from public,anon,authenticated,service_role;
create trigger work_card_place before insert or update on public.work_cards for each row execute function public.work_card_place();

alter table public.work_cards alter column board_order set not null;

-- A Card is placed where its person drops it or moves it: above another Card of that column (before_card), or at the
-- column's end. A move to another column takes that column's stage by the same rule as move_work_card_to_column (the
-- column's stage of the Card's own kind when there is one, else its first), runs as the caller so every stage rule and
-- row-level security apply, and is logged like any stage change; a change of place inside one column is not logged and
-- raises no notice. "Waiting on you" is filled by the database, never placed, and a Card after review is placed only by
-- the people who manage the Company.
create function public.place_work_card(c uuid, card bigint, target text, before_card bigint default null, evidence text default null) returns bigint
language plpgsql security invoker set search_path='' as $$
declare current_kind text; current_column text; stage bigint; arrived text; before_place numeric; previous_place numeric; place numeric; begin
 if target is null or target not in ('waiting','ideas','planned','progress','live','done') then raise exception 'unknown column' using errcode='22023'; end if;
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 select s.kind,s.board_column into current_kind,current_column from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id
  where w.company_id=c and w.id=card;
 if not found then raise exception 'card not found or not permitted'; end if;
 if current_column='waiting' or target='waiting' then raise exception 'waiting is not placed by hand' using errcode='42501'; end if;
 if (current_column in ('live','done') or target in ('live','done') or current_kind='after_review') and not public.can_manage_company(c) then
  raise exception 'not permitted' using errcode='42501'; end if;
 if target<>current_column then
  select s.id,s.kind into stage,arrived from public.work_stages s where s.company_id=c and s.board_column=target
   order by (s.kind=current_kind) desc,s.position,s.id limit 1;
  if stage is null then raise exception 'column has no stage'; end if;
  if arrived='after_review' and not public.can_manage_company(c) then raise exception 'not permitted' using errcode='42501'; end if;
  perform public.move_work_card(c,card,stage,evidence);
 end if;
 if before_card is null then
  select coalesce(max(w.board_order),0)+1 into place from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id
   where w.company_id=c and s.board_column=target and w.id<>card;
 else
  select w.board_order into before_place from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id
   where w.company_id=c and s.board_column=target and w.id=before_card and w.id<>card;
  if not found then raise exception 'the card it lands above is not in that column' using errcode='22023'; end if;
  select max(w.board_order) into previous_place from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id
   where w.company_id=c and s.board_column=target and w.id<>card and w.id<>before_card and w.board_order<before_place;
  place=case when previous_place is null then before_place-1 else (previous_place+before_place)/2 end;
 end if;
 update public.work_cards w set board_order=place where w.company_id=c and w.id=card;
 if not found then raise exception 'card not found or not permitted'; end if;
 return stage;
end $$;
revoke all on function public.place_work_card(uuid,bigint,text,bigint,text) from public,anon,service_role;
grant execute on function public.place_work_card(uuid,bigint,text,bigint,text) to authenticated;

-- An idea added in the Ideas column (#188) goes to the top of Ideas, as the reference's saveIdea puts it first; every
-- other Card made without a place still takes its column's end. The same checks as 20270215000000_add_idea, with the place.
create or replace function public.create_work_card(c uuid, s bigint, card_title text, agent uuid) returns bigint language plpgsql security invoker set search_path='' as $$
declare result bigint; begin
 if not public.work_can_edit(c) then raise exception 'not permitted'; end if;
 if btrim(coalesce(card_title,''))='' then raise exception 'invalid idea' using errcode='22023'; end if;
 if not exists(select 1 from public.work_stages where company_id=c and id=s and kind='ideas') then raise exception 'no Ideas stage'; end if;
 if agent is null or not exists(select 1 from public.hermes_agents h where h.company_id=c and h.id=agent)
  or not public.agent_visible_to(c,auth.uid(),agent) then raise exception 'agent not found'; end if;
 perform set_config('work.idea','yes',true);
 insert into public.work_cards(company_id,stage_id,title,agent_id,board_order) values(c,s,card_title,agent,
  coalesce((select min(w.board_order) from public.work_cards w join public.work_stages t on t.company_id=w.company_id and t.id=w.stage_id
   where w.company_id=c and t.board_column='ideas'),1)-1) returning id into result;
 perform set_config('work.idea','',true);
 return result;
end $$;
