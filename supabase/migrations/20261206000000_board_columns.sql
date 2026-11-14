-- The board shows the approved design's six columns (#34, ADR 0013). A stage keeps doing what it does (approvals,
-- the agent API, the rules on who may move a card past review); each stage now names the column it is shown in.
-- Nothing is rewritten: every card keeps its stage, so the previous app version runs against this database unchanged.
-- One stage is added per Company, «خلص» (Done), the only column no earlier stage maps onto.
--
-- The recorded mapping (the nine default stages):
--   أفكار → ideas · بريف جاهز → planned · كتابة, تصميم ومونتاج → progress · مراجعة → waiting
--   معتمد, مجدول للنشر → planned · منشور, إعلانات شغالة → live · خلص (new) → done
-- A renamed or added stage is placed by what it is: Ideas by its kind, review by its kind, a keyed stage by its key,
-- a stage before review ahead of «كتابة» is planned and after it in progress, any other stage after review is live.

create function public.work_stage_column(stage_company uuid, stage_kind text, key text, stage_position integer) returns text
language sql stable security definer set search_path='' as $$
 select case
  when stage_kind='ideas' then 'ideas'
  when stage_kind='review' then 'waiting'
  when key in ('writing','design') then 'progress'
  when key in ('approved','scheduled') then 'planned'
  when stage_kind='before_review' and stage_position<coalesce((select w.position from public.work_stages w where w.company_id=stage_company and w.stage_key='writing'),0) then 'planned'
  when stage_kind='before_review' then 'progress'
  else 'live' end;
$$;
revoke all on function public.work_stage_column(uuid,text,text,integer) from public,anon,authenticated,service_role;

alter table public.work_stages add column board_column text;
update public.work_stages set board_column=public.work_stage_column(company_id,kind,stage_key,position);

-- A stage made later takes its column the same way, after its stage key is set (work_stage_key_guard runs first:
-- triggers of one event run in name order).
create function public.work_stage_place() returns trigger language plpgsql set search_path='' as $$
begin
 if new.board_column is null then new.board_column=public.work_stage_column(new.company_id,new.kind,new.stage_key,new.position); end if;
 return new;
end $$;
revoke all on function public.work_stage_place() from public,anon,authenticated,service_role;
create trigger work_stage_place before insert on public.work_stages for each row execute function public.work_stage_place();

-- «خلص» (Done): after review, so only the people who manage the Company move a card there, as for every stage after review.
insert into public.work_stages(company_id,name,position,kind,board_column)
 select c.id,'خلص',coalesce((select max(s.position) from public.work_stages s where s.company_id=c.id),0)+1,'after_review','done'
 from public.companies c where not exists(select 1 from public.work_stages s where s.company_id=c.id and s.board_column='done');

alter table public.work_stages alter column board_column set not null;
alter table public.work_stages add constraint work_stages_board_column check (board_column in ('waiting','ideas','planned','progress','live','done'));
-- "Waiting on you" holds exactly the cards waiting for a decision, and Ideas is where a message to an agent lands.
alter table public.work_stages add constraint work_stages_waiting_is_review check ((kind='review')=(board_column='waiting'));
alter table public.work_stages add constraint work_stages_ideas_column check (kind<>'ideas' or board_column='ideas');

-- A new Company gets the nine stages and «خلص».
create or replace function public.work_defaults() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.work_stages(company_id,name,position,kind,board_column) select new.id,n,ord,case when ord=1 then 'ideas' when ord=5 then 'review' when ord>5 then 'after_review' else 'before_review' end,
  (array['ideas','planned','progress','progress','waiting','planned','planned','live','live','done'])[ord]
  from unnest(array['أفكار','بريف جاهز','كتابة','تصميم ومونتاج','مراجعة','معتمد','مجدول للنشر','منشور','إعلانات شغالة','خلص']) with ordinality as x(n,ord);
 insert into public.work_labels(company_id,name,color) select new.id,n,c from (values ('static','#87bba2'),('reel','#bd8d81'),('carosel','#cdbb78'),('Paid','#a58bc1'),('content','#83a6be'),('Campaign','#d6a76f'),('Urgent','#d78484'),('Website','#8abbb7')) x(n,c); return new; end $$;

-- A move on the board names a column; the card goes to that column's stage of its own kind when there is one, else to
-- the column's first stage. The move runs as the caller (row-level security and every stage rule apply), and it is
-- logged like any stage change (work_audit: card_changed, stage_id, with both stage names).
create function public.move_work_card_to_column(c uuid, card bigint, target text, evidence text default null) returns bigint
language plpgsql set search_path='' as $$
declare current_kind text; current_column text; stage bigint; begin
 if target is null or target not in ('waiting','ideas','planned','progress','live','done') then raise exception 'unknown column' using errcode='22023'; end if;
 select s.kind,s.board_column into current_kind,current_column from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id where w.company_id=c and w.id=card;
 if not found then raise exception 'card not found or not permitted'; end if;
 if current_column=target then return null; end if;
 select s.id into stage from public.work_stages s where s.company_id=c and s.board_column=target order by (s.kind=current_kind) desc,s.position,s.id limit 1;
 if stage is null then raise exception 'column has no stage'; end if;
 perform public.move_work_card(c,card,stage,evidence);
 return stage;
end $$;
revoke all on function public.move_work_card_to_column(uuid,bigint,text,text) from public,anon,service_role;
grant execute on function public.move_work_card_to_column(uuid,bigint,text,text) to authenticated;
