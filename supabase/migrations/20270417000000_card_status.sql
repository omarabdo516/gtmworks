-- #676 (spec #668, ADR 0026): a Card has one status, and the status is its column. This is the first step of ADR 0023:
-- it adds the status and keeps the stage written beside it, so the previous release, which reads and writes stages,
-- still runs; nothing is dropped here. The cutover (#684) drops the stages once this release answers.
--
-- Both shapes stay written by one trigger: a stage written (the previous release, a decision, the triggers that make a
-- Card from a chat, a channel or a Handover) moves the status to that stage's column, and a status written (this
-- release) moves the stage to that column's first stage no approval gives. move_card is the one way a person moves a
-- Card, check_card_move holds every rule of a move, every move is logged and remembered in both shapes, and
-- undo_card_move puts the caller's last move back as the board's "Undo" did.

-- 1. The status, filled from each Card's stage.
alter table public.work_cards add column status text;
update public.work_cards w set status=coalesce(s.board_column,'ideas') from public.work_stages s where s.company_id=w.company_id and s.id=w.stage_id;
alter table public.work_cards alter column status set not null,
 add constraint work_cards_status_known check (status in ('waiting','ideas','planned','progress','live','done'));
create index work_cards_status on public.work_cards(company_id,status);

-- 2. The stage a status lands on: the Card's own stage when it is already in that column, else the column's first stage
-- that no approval gives («معتمد», «مجدول للنشر» are an approval's), so a move never reads as approved.
create function public.card_status_stage(c uuid, target text, current_stage bigint)
returns bigint language sql stable set search_path='' as $$
 select coalesce(
  (select s.id from public.work_stages s where s.company_id=c and s.id=current_stage and s.board_column=target),
  (select s.id from public.work_stages s where s.company_id=c and s.board_column=target
    order by s.stage_key is not null and s.stage_key in ('approved','scheduled'),s.position,s.id limit 1));
$$;
revoke all on function public.card_status_stage(uuid,text,bigint) from public,anon,authenticated,service_role;

-- 3. Both shapes, kept equal before every other trigger reads the row (BEFORE triggers run by name: "align" sorts before
-- "approval_card_guard", so the stage rules and the place see the stage the status asked for). A stage written wins: it
-- is the previous release's whole move.
create function public.align_card_status() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is not null and new.status not in ('waiting','ideas','planned','progress','live','done') then
  raise exception 'unknown column' using errcode='23514'; end if;
 if tg_op='INSERT' then
  if new.status is not null and (new.stage_id is null
   or (select s.board_column from public.work_stages s where s.company_id=new.company_id and s.id=new.stage_id) is distinct from new.status) then
   new.stage_id=public.card_status_stage(new.company_id,new.status,new.stage_id);
  else
   new.status=coalesce((select s.board_column from public.work_stages s where s.company_id=new.company_id and s.id=new.stage_id),'ideas');
  end if;
 elsif new.stage_id is distinct from old.stage_id then
  new.status=coalesce((select s.board_column from public.work_stages s where s.company_id=new.company_id and s.id=new.stage_id),'ideas');
 elsif new.status is distinct from old.status then
  new.stage_id=public.card_status_stage(new.company_id,new.status,old.stage_id);
  if new.stage_id is null then raise exception 'column has no stage' using errcode='22023'; end if;
 end if;
 return new;
end $$;
revoke all on function public.align_card_status() from public,anon,authenticated,service_role;
create trigger align_card_status before insert or update of stage_id,status on public.work_cards
 for each row execute function public.align_card_status();

-- 4. The stage rules step aside for move_card (work.move), whose rules are the ones this release keeps: people who may
-- edit move a Card freely, Live and Done included. Every other write keeps the previous release's rules.
create or replace function public.work_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$ declare stage_kind text; previous_kind text; begin
 if tg_op='UPDATE' and new.company_id<>old.company_id then raise exception 'company cannot change'; end if;
 if current_setting('approval.internal',true) is distinct from 'yes' and coalesce(current_setting('work.move',true),'')<>'yes' and (tg_op='INSERT' or new.stage_id<>old.stage_id) and auth.uid() is not null and not public.can_manage_company(new.company_id) then
 select kind into stage_kind from public.work_stages where id=new.stage_id and company_id=new.company_id;
 if tg_op='UPDATE' then select kind into previous_kind from public.work_stages where id=old.stage_id and company_id=old.company_id; end if;
 if stage_kind='after_review' or previous_kind='after_review' then raise exception 'contributors cannot move beyond review'; end if; end if; return new; end $function$;

create or replace function public.approval_card_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare oldkind text; newkind text; firststep bigint; begin
 select kind into newkind from public.work_stages where company_id=new.company_id and id=new.stage_id;
 if tg_op='UPDATE' then select kind into oldkind from public.work_stages where company_id=old.company_id and id=old.stage_id; end if;
 if current_setting('approval.internal',true) is distinct from 'yes' then
  if tg_op='INSERT' and (new.approval_step_id is not null or new.review_submitter is not null or new.rejection_reason is not null or new.review_entered_at is not null) then raise exception 'approval fields are protected'; end if;
  if tg_op='UPDATE' and (new.approval_step_id is distinct from old.approval_step_id or new.review_submitter is distinct from old.review_submitter or new.rejection_reason is distinct from old.rejection_reason or new.review_entered_at is distinct from old.review_entered_at) then raise exception 'approval fields are protected'; end if;
  if tg_op='UPDATE' and oldkind='review' and new.next_actor is distinct from old.next_actor then raise exception 'current approver controls next actor'; end if;
  if newkind='after_review' and (tg_op='INSERT' or oldkind is distinct from newkind) and coalesce(current_setting('work.move',true),'')<>'yes' then if not public.can_manage_company(new.company_id) then raise exception 'contributors cannot move beyond review'; end if; raise exception 'approval required'; end if;
  if newkind='review' and (tg_op='INSERT' or oldkind is distinct from 'review') then
   select id into firststep from public.approval_steps where company_id=new.company_id and removed_at is null order by position,id limit 1;
   if firststep is null then raise exception 'approval step required'; end if;
   new.approval_step_id=firststep; new.review_submitter=auth.uid(); new.review_entered_at=now(); new.rejection_reason=null; new.next_actor=public.approval_actor(new.company_id,firststep);
  elsif tg_op='UPDATE' and oldkind='review' and newkind<>'review' then raise exception 'decision required'; end if;
 end if;
 return new; end $function$;

-- 5. Every move is remembered in both shapes, so either release's Undo puts it back.
alter table public.work_card_moves add column from_status text, add column to_status text;
update public.work_card_moves m set from_status=f.board_column,to_status=t.board_column
 from public.work_stages f,public.work_stages t where f.company_id=m.company_id and f.id=m.from_stage_id and t.company_id=m.company_id and t.id=m.to_stage_id;

create or replace function public.work_card_moved()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
 if (new.stage_id is distinct from old.stage_id or new.status is distinct from old.status) and coalesce(current_setting('work.undo',true),'')<>'yes'
  and coalesce(current_setting('approval.internal',true),'')<>'yes' then
  insert into public.work_card_moves(company_id,card_id,person_id,from_stage_id,from_place,to_stage_id,to_place,from_status,to_status)
   values(new.company_id,new.id,auth.uid(),old.stage_id,old.board_order,new.stage_id,new.board_order,old.status,new.status);
 end if;
 return null;
end $function$;

-- 6. Every move is logged: the stage's row the previous release reads, with the two statuses this release reads.
create or replace function public.work_audit()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare rowdata jsonb; previous jsonb; cid bigint; company uuid; field text; ev text; details jsonb; action_name text; begin
 rowdata=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 previous=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
 company=(rowdata->>'company_id')::uuid; cid=case when tg_table_name='work_cards' then (rowdata->>'id')::bigint else (rowdata->>'card_id')::bigint end;
 ev=nullif(current_setting('work.evidence',true),'');
 if tg_table_name='work_cards' and tg_op='UPDATE' then
  foreach field in array array['title','stage_id','offering','segment','hook','channel','format','go_live','goal','caption','next_actor','project_id'] loop
   if rowdata->field is distinct from previous->field then
    details=jsonb_build_object('field',field,'old',previous->field,'new',rowdata->field);
    if field='stage_id' then details=details || jsonb_build_object('old_name',(select name from public.work_stages where id=(previous->>'stage_id')::bigint),'new_name',(select name from public.work_stages where id=(rowdata->>'stage_id')::bigint),
      'old_status',previous->'status','new_status',rowdata->'status');
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
 end if; return coalesce(new,old); end $function$;

-- 7. Every rule of a move, in one place. A person who may edit moves a Card they see, current and in this Company,
-- to any of the six columns but "Waiting on you": a question, a review or a failure puts a Card there, and only the
-- answer takes it out (a Card in review by its decision, a Card its chat holds by the chat's answer). Answers the
-- status the Card is in.
create function public.check_card_move(c uuid, card bigint, target text)
returns text language plpgsql stable set search_path='' as $$
declare w public.work_cards; begin
 if target is null or target not in ('waiting','ideas','planned','progress','live','done') then raise exception 'unknown column' using errcode='22023'; end if;
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 -- Read as the caller: an archived Card, one whose Agent is hidden from them, or another Company's is no Card at all.
 select * into w from public.work_cards x where x.company_id=c and x.id=card and x.archived_at is null;
 if not found or not public.can_see_card(c,card) then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 if w.status='waiting' or target='waiting' or public.card_wait(w) is not null then raise exception 'waiting is not placed by hand' using errcode='42501'; end if;
 return w.status;
end $$;
revoke all on function public.check_card_move(uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.check_card_move(uuid,bigint,text) to authenticated;

-- 8. A move: the Card goes to the target column, above before_card (null: at the column's end). Answers the column it
-- left, or null when it stayed in its column (a place inside one column).
create function public.move_card(c uuid, card bigint, target text, before_card bigint default null, evidence text default null)
returns text language plpgsql set search_path='' as $$
declare from_status text; before_place numeric; previous_place numeric; place numeric; begin
 from_status=public.check_card_move(c,card,target);
 if before_card is null then
  select coalesce(max(w.board_order),0)+1 into place from public.work_cards w where w.company_id=c and w.status=target and w.id<>card;
 else
  -- The column's Cards are locked, so the place read here is still the place when the Card takes it; two Cards on one
  -- place leave no number between them, so the column is numbered again, two apart, in the board's order (#174).
  perform 1 from public.work_cards w where w.company_id=c and w.status=target and w.id<>card for update;
  if exists(select 1 from public.work_cards w where w.company_id=c and w.status=target and w.id<>card group by coalesce(w.board_order,0) having count(*)>1) then
   update public.work_cards w set board_order=o.again from (select w2.id,(row_number() over (order by coalesce(w2.board_order,0),w2.id))*2 as again
    from public.work_cards w2 where w2.company_id=c and w2.status=target and w2.id<>card) o where w.company_id=c and w.id=o.id;
  end if;
  select w.board_order into before_place from public.work_cards w where w.company_id=c and w.status=target and w.id=before_card and w.id<>card;
  if not found then raise exception 'the card it lands above is not in that column' using errcode='22023'; end if;
  select max(w.board_order) into previous_place from public.work_cards w
   where w.company_id=c and w.status=target and w.id<>card and w.id<>before_card and w.board_order<before_place;
  place=case when previous_place is null then before_place-1 else (previous_place+before_place)/2 end;
 end if;
 perform set_config('work.evidence',coalesce(evidence,''),true);
 perform set_config('work.place_exact','yes',true);
 perform set_config('work.move','yes',true);
 update public.work_cards w set status=target,board_order=place where w.company_id=c and w.id=card;
 perform set_config('work.move','',true);
 perform set_config('work.place_exact','',true);
 return case when from_status<>target then from_status end;
end $$;
revoke all on function public.move_card(uuid,bigint,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.move_card(uuid,bigint,text,bigint,text) to authenticated;

-- 9. "Undo" (#168): the caller's last move of the Card, while it is still the Card's latest, goes back to the status,
-- the stage and the place it left, under the same rules as any move. Answers the column it returned to.
create function public.undo_card_move(c uuid, card bigint)
returns text language plpgsql set search_path='' as $$
declare moved public.work_card_moves; now_status text; now_stage bigint; now_place numeric; back text; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 -- The Card is locked first, so no move commits between the checks and the way back.
 select w.status,w.stage_id,w.board_order into now_status,now_stage,now_place from public.work_cards w where w.company_id=c and w.id=card for update;
 if not found then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 select m.* into moved from public.work_card_moves m where m.company_id=c and m.card_id=card and m.person_id=auth.uid() order by m.id desc limit 1;
 if not found then raise exception 'nothing to undo' using errcode='42501'; end if;
 if moved.id is distinct from public.work_card_latest_move(c,card) or now_stage is distinct from moved.to_stage_id
  or now_status is distinct from coalesce(moved.to_status,now_status) or now_place is distinct from moved.to_place then
  raise exception 'the card moved on' using errcode='P0001';
 end if;
 back=coalesce(moved.from_status,(select s.board_column from public.work_stages s where s.company_id=c and s.id=moved.from_stage_id));
 perform public.check_card_move(c,card,back);
 perform set_config('work.undo','yes',true);
 perform set_config('work.place_exact','yes',true);
 perform set_config('work.move','yes',true);
 update public.work_cards w set status=back,stage_id=moved.from_stage_id,board_order=moved.from_place where w.company_id=c and w.id=card;
 perform set_config('work.move','',true);
 perform set_config('work.place_exact','',true);
 perform set_config('work.undo','',true);
 return back;
end $$;
revoke all on function public.undo_card_move(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.undo_card_move(uuid,bigint) to authenticated;

-- 10. "Waiting on you" reads a Card in review by its status (the Numbers page's waiting panel and the sidebar count).
create or replace function public.waiting_list(c uuid)
 returns table(kind text, id bigint, title text, body text, asked_by text, card_id bigint, conversation_id uuid, created_at timestamp with time zone)
 language sql
 stable
 set search_path to ''
as $function$
 select * from (
  select 'approval'::text, w.id, w.title, coalesce(a.name,''), ''::text, w.id, null::uuid, coalesce(w.review_entered_at,w.created_at)
   from public.work_cards w
   left join public.approval_steps a on a.company_id=w.company_id and a.id=w.approval_step_id
   where w.company_id=c and w.status='waiting' and w.approval_step_id is not null and public.approval_holds(c,w.approval_step_id)
  union all
  select i.kind, i.id, i.title, i.body, i.asked_by, i.card_id, i.conversation_id, i.created_at
   from public.waiting_items i where i.company_id=c and i.person_id=auth.uid() and i.resolved_at is null
  union all
  select 'agent_request'::text, r.id, r.agent_name, r.job, coalesce(p.name,''), null::bigint, null::uuid, r.created_at
   from public.lead_agent_requests r
   join public.members m on m.company_id=r.company_id and m.person_id=r.asked_by and m.removed_at is null
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and r.state='waiting' and public.is_company_owner(c)
  union all
  select r.kind, r.id, case r.kind when 'question' then r.content->>'question' else r.title end, ''::text, v.agent_name,
    (select w.id from public.work_cards w where w.company_id=c and w.conversation_id=r.conversation_id), r.conversation_id, r.created_at
   from public.reply_cards r
   join public.conversations v on v.id=r.conversation_id and v.company_id=r.company_id
   where r.company_id=c and r.kind in ('question','hand','permission') and v.person_id=auth.uid() and public.reply_card_waits(r)
  union all
  select 'channel_permission'::text, p.id, p.title, ''::text, r.agent_name, null::bigint, null::uuid, p.created_at
   from public.channel_permissions p
   join public.channel_runs r on r.message_id=p.message_id and r.ordinal=p.ordinal
   where p.company_id=c and p.state='open' and public.channel_permission_waits(p)
  union all
  select 'channel_question'::text, r.id, r.content->>'question', ''::text, cr.agent_name, null::bigint, null::uuid, r.created_at
   from public.reply_cards r
   join public.channel_messages m on m.id=r.channel_message_id
   join public.channel_runs cr on cr.message_id=r.channel_message_id and cr.ordinal=coalesce(r.channel_ordinal,1)
   where r.company_id=c and r.kind='question' and r.state='open' and cr.outcome is null
    and public.conversation_can_write(c) and public.in_channel(m.channel_id)
    and (r.addressed_to is null or r.addressed_to=auth.uid())
  union all
  select 'channel_hand'::text, r.id, r.title, ''::text, cr.agent_name, null::bigint, null::uuid, r.created_at
   from public.reply_cards r
   join public.channel_messages m on m.id=r.channel_message_id
   join public.channel_runs cr on cr.message_id=r.channel_message_id and cr.ordinal=coalesce(r.channel_ordinal,1)
   where r.company_id=c and r.kind='hand' and r.state='open'
    and public.conversation_can_write(c) and public.in_channel(m.channel_id)
  union all
  select 'agent_key'::text, k.id, g.name, ''::text, ''::text, null::bigint, null::uuid, k.created_at
   from public.agent_key_waits k
   join public.hermes_agents g on g.company_id=k.company_id and g.id=k.agent_id
   where k.company_id=c and public.agent_key_waits_shown(c)
  union all
  select 'agent_change'::text, p.id, g.name, p.change, b.name, null::bigint, null::uuid, p.created_at
   from public.agent_change_proposals p
   join public.hermes_agents g on g.company_id=p.company_id and g.id=p.agent_id
   join public.hermes_agents b on b.company_id=p.company_id and b.id=p.proposed_by
   where p.company_id=c and p.state in ('waiting','applying') and public.is_company_owner(c)
  union all
  select 'agent_access'::text, r.id, g.name, g.speciality, coalesce(p.name,''), null::bigint, null::uuid, r.pressed_at
   from public.agent_access_requests r
   join public.hermes_agents g on g.company_id=r.company_id and g.id=r.agent_id
   join public.members m on m.company_id=r.company_id and m.person_id=r.asked_by and m.removed_at is null
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and public.agent_access_waits(r)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$function$;
