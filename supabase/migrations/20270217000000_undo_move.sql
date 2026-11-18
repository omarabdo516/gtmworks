-- "Undo" on a move (#168). A move on the board gives a Card another column's stage and a place in it; the person who
-- moved it may put it back, to the stage it left and the place it held, for as long as the Card is still where that move
-- put it. A board column covers several stages (ADR 0013), so the stage is kept, not only the column.
--
-- Every change of a Card's stage is remembered here by the Card table itself, so each path that moves a Card is
-- remembered alike: a board drag or the keyboard, the card's sheet, an approval decision, and the Agent API. Nothing is
-- rewritten: this table is new, the previous app version never reads it, and the moves it makes are remembered as any
-- other. The functions it calls keep their signatures and behaviour.

create table public.work_card_moves (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 card_id bigint not null,
 person_id uuid,
 from_stage_id bigint not null,
 from_place numeric,
 to_stage_id bigint not null,
 to_place numeric,
 moved_at timestamptz not null default now(),
 foreign key(company_id,card_id) references public.work_cards(company_id,id)
);
-- Only the Card table writes a move. A Member reads only their own moves, which is all "Undo" needs: another person's
-- moves, of Cards that may be hidden from this Member, stay theirs.
alter table public.work_card_moves enable row level security;
revoke all on public.work_card_moves from anon,authenticated,service_role;
create policy work_card_moves_read on public.work_card_moves for select to authenticated using (person_id=auth.uid() and public.is_member(company_id));
grant select on public.work_card_moves to authenticated;
create index work_card_moves_seek on public.work_card_moves(company_id,card_id,person_id,moved_at desc,id desc);

-- The stage and place a Card left, and the stage and place it arrived at. place_work_card settles a board move's place in
-- the same update as its stage (below), so the row names the place the Card really took. A move back is not a move to
-- undo in turn, and it is logged as its own row by work_audit, so neither is remembered here. A decision is the one move
-- a person cannot take back: decide_approval writes the stage it gives the Card with approval.internal marked, and that
-- write is not remembered, so "Undo" never offers the approver their own decision (#168).
create function public.work_card_moved() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.stage_id is distinct from old.stage_id and coalesce(current_setting('work.undo',true),'')<>'yes'
  and coalesce(current_setting('approval.internal',true),'')<>'yes' then
  insert into public.work_card_moves(company_id,card_id,person_id,from_stage_id,from_place,to_stage_id,to_place)
   values(new.company_id,new.id,auth.uid(),old.stage_id,old.board_order,new.stage_id,new.board_order);
 end if;
 return null;
end $$;
revoke all on function public.work_card_moved() from public,anon,authenticated,service_role;
create trigger work_card_moved after update on public.work_cards for each row execute function public.work_card_moved();

-- A Card placed by hand arrives with the place chosen for it, in the same update as its stage (#174, unchanged else):
-- work_card_place leaves a place the caller named alone, so the remembered move carries it.
create or replace function public.work_card_place() returns trigger language plpgsql security definer set search_path='' as $$
declare arrived text; left_column text; begin
 if coalesce(current_setting('work.place_exact',true),'')='yes' then return new; end if;
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

-- A Card is placed where its person drops it or moves it (#174): above another Card of that column (before_card), or at
-- the column's end. The place and the column's stage are written together, so the move is remembered once, with the
-- place the Card really took. The checks, the stage chosen and the log row are as before.
create or replace function public.place_work_card(c uuid, card bigint, target text, before_card bigint default null, evidence text default null) returns bigint
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
 perform set_config('work.evidence',coalesce(evidence,''),true);
 perform set_config('work.place_exact','yes',true);
 update public.work_cards w set stage_id=coalesce(stage,w.stage_id),board_order=place where w.company_id=c and w.id=card;
 perform set_config('work.place_exact','',true);
 if not found then raise exception 'card not found or not permitted'; end if;
 return stage;
end $$;
revoke all on function public.place_work_card(uuid,bigint,text,bigint,text) from public,anon,service_role;
grant execute on function public.place_work_card(uuid,bigint,text,bigint,text) to authenticated;

-- "Undo": the caller's own latest move of this Card, put back, as the caller (row-level security and every stage rule
-- apply, as to any move). It refuses when the Card is not where that move put it any more (someone else moved it, or a
-- decision did), when the caller made no move of it, when the stage it came from or went to is after review and the
-- caller does not manage the Company, and when either side is "Waiting on you", which only a decision empties.
create function public.undo_work_card_move(c uuid, card bigint) returns text
language plpgsql security invoker set search_path='' as $$
declare moved public.work_card_moves; current_stage bigint; current_place numeric; current_column text; current_kind text;
 from_column text; from_kind text; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 select m.* into moved from public.work_card_moves m where m.company_id=c and m.card_id=card and m.person_id=auth.uid()
  order by m.moved_at desc,m.id desc limit 1;
 if not found then raise exception 'nothing to undo' using errcode='42501'; end if;
 select w.stage_id,w.board_order,s.board_column,s.kind into current_stage,current_place,current_column,current_kind
  from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id
  where w.company_id=c and w.id=card;
 if not found then raise exception 'card not found or not permitted'; end if;
 if current_stage is distinct from moved.to_stage_id or current_place is distinct from moved.to_place then
  raise exception 'the card moved on' using errcode='P0001';
 end if;
 select s.board_column,s.kind into from_column,from_kind from public.work_stages s where s.company_id=c and s.id=moved.from_stage_id;
 if from_column is null then raise exception 'card not found or not permitted'; end if;
 if current_column='waiting' or from_column='waiting' then raise exception 'waiting is not placed by hand' using errcode='42501'; end if;
 if (current_column in ('live','done') or from_column in ('live','done') or current_kind='after_review' or from_kind='after_review')
  and not public.can_manage_company(c) then raise exception 'not permitted' using errcode='42501'; end if;
 perform set_config('work.undo','yes',true);
 perform set_config('work.place_exact','yes',true);
 update public.work_cards w set stage_id=moved.from_stage_id,board_order=moved.from_place where w.company_id=c and w.id=card;
 perform set_config('work.place_exact','',true);
 perform set_config('work.undo','',true);
 if not found then raise exception 'card not found or not permitted'; end if;
 return from_column;
end $$;
revoke all on function public.undo_work_card_move(uuid,bigint) from public,anon,service_role;
grant execute on function public.undo_work_card_move(uuid,bigint) to authenticated;

-- The way back is one row of its own, "moved the card back" (design-reference: undoMove's log line), with who made it and
-- the board column it left and returned to (20270215000000_add_idea's work_audit, unchanged else).
create or replace function public.work_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare rowdata jsonb; previous jsonb; cid bigint; company uuid; field text; ev text; details jsonb; action_name text; begin
 rowdata=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 previous=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
 company=(rowdata->>'company_id')::uuid; cid=case when tg_table_name='work_cards' then (rowdata->>'id')::bigint else (rowdata->>'card_id')::bigint end;
 ev=nullif(current_setting('work.evidence',true),'');
 if tg_table_name='work_cards' and tg_op='UPDATE' then
  foreach field in array array['title','stage_id','offering','segment','hook','channel','format','go_live','goal','caption','next_actor','project_id'] loop
   if rowdata->field is distinct from previous->field then
    details=jsonb_build_object('field',field,'old',previous->field,'new',rowdata->field);
    if field='stage_id' then details=details || jsonb_build_object('old_name',(select name from public.work_stages where id=(previous->>'stage_id')::bigint),'new_name',(select name from public.work_stages where id=(rowdata->>'stage_id')::bigint));
     -- The way back (#168) is told by the board's columns, not the stages: it is the board's own "Undo".
     if coalesce(current_setting('work.undo',true),'')='yes' then details=details || jsonb_build_object('old_column',(select board_column from public.work_stages where id=(previous->>'stage_id')::bigint),'new_column',(select board_column from public.work_stages where id=(rowdata->>'stage_id')::bigint)); end if; end if;
    if field='project_id' then details=details || jsonb_build_object('old_name',(select name from public.work_projects where id=(previous->>'project_id')::bigint),'new_name',(select name from public.work_projects where id=(rowdata->>'project_id')::bigint)); end if;
    insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),
     case when field='stage_id' and coalesce(current_setting('work.undo',true),'')='yes' then 'card_moved_back' else 'card_changed' end,details,ev);
   end if;
  end loop;
 else
  action_name=case tg_table_name when 'work_cards' then case when current_setting('work.idea',true)='yes' then 'idea_added' else 'card_created' end when 'work_checklist' then 'checklist_changed' when 'work_card_labels' then 'label_changed' when 'work_assignees' then 'assignee_changed' when 'work_creatives' then 'creative_added' when 'work_versions' then 'version_added' when 'work_comments' then 'comment_added' end;
  if tg_table_name='work_versions' then ev=coalesce(ev,rowdata->>'path'); end if;
  insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),action_name,rowdata,ev);
 end if; return coalesce(new,old); end $$;
