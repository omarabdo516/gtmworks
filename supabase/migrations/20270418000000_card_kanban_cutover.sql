-- #684 (spec #668, ADR 0026, ADR 0023): the second step of the Card's move to the Hermes Kanban way, the cutover.
-- scripts/install.sh applies a migration whose name ends in _cutover only once this release's app answers its health
-- check and its worker runs, so the release it replaced has stopped serving, and a failed update has left it running on
-- the first step's schema (20270417050000_card_status.sql and the steps after it), which writes both shapes.
--
-- First every Card's old fields, checklist, labels, mode and other assignees are written into its description, as they
-- stand now, so what the previous release wrote between the two steps is kept. Then stages, labels, the checklist, the
-- assignees list, next actor, mode, the marketing fields, templates, approval steps and Work settings go, with the
-- previous release's functions that wrote them. Every function that read them reads the status, the one assignee and
-- the description instead.
--
-- Kept on purpose: Versions, files, comments and every log row, with the audit shapes that name stages and fields, so
-- history still reads; the Card's Agent column, which stays equal to its assignee Agent; the review's own fields.

-- 0. A cutover never lands in the transaction that applied its first step (the levels cutover's guard, #389).
do $$ begin
 if to_regclass('gtmworks_install.schema_migrations') is not null then
  if exists(select 1 from gtmworks_install.schema_migrations m where m.name='20270417050000_card_status.sql' and m.xmin=pg_current_xact_id()::xid) then
   raise exception 'This update is finished by the installer it downloaded: run sh scripts/install.sh update again. The database and the running release were not changed.';
  end if;
 end if;
end $$;

-- 1. The old fields, checklist, labels, mode, next actor and other assignees, written into each Card's description once:
-- a block after what the description holds, only for a Card that has any of them. A value's lines are written as text,
-- never as Markdown of their own (a caption's "- [ ]" is no to-do item, its "#" no heading). Safe to run again: once the
-- columns are gone there is nothing left to write.
create or replace function pg_temp.as_text(value text) returns text language sql immutable as $f$
 select string_agg(regexp_replace(regexp_replace(l,'^(\s*)([-*+#>|])','\1\\\2'),'^(\s*)([0-9]+)([.)])','\1\2\\\3'),E'  \n' order by n) from unnest(string_to_array(btrim(value),E'\n')) with ordinality u(l,n) $f$;
do $$
declare w record; lines text[]; field record; names text; items text; block text;
begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='hook') then return; end if;
 perform set_config('approval.internal','yes',true);
 for w in select * from public.work_cards order by id loop
  lines:=array[]::text[];
  for field in select * from (values ('Hook',w.hook),('Offering',w.offering),('Segment',w.segment),('Goal',w.goal),('Channel',w.channel),('Format',w.format),('Caption',w.caption)) f(label,value) loop
   if btrim(coalesce(field.value,''))<>'' then lines:=lines||('**'||field.label||':** '||pg_temp.as_text(field.value))::text; end if;
  end loop;
  if w.mode is not null then lines:=lines||('**Mode:** '||case w.mode when 'plan' then 'Plan it' when 'do' then 'Do it now' when 'answer' then 'Answer only' else pg_temp.as_text(w.mode) end)::text; end if;
  select string_agg(pg_temp.as_text(l.name),', ' order by l.name) into names from public.work_card_labels x join public.work_labels l on l.id=x.label_id and l.company_id=x.company_id where x.card_id=w.id;
  if names is not null then lines:=lines||('**Labels:** '||names)::text; end if;
  -- The next actor, when the Card's one assignee is someone else (an Agent, or the person a review was asked by).
  if w.next_actor is not null and w.next_actor is distinct from w.assignee_person then
   select p.name into names from public.people p where p.id=w.next_actor;
   if btrim(coalesce(names,''))<>'' then lines:=lines||('**Next:** '||pg_temp.as_text(names))::text; end if;
  end if;
  select string_agg(pg_temp.as_text(p.name),', ' order by a.id) into names from public.work_assignees a join public.people p on p.id=a.person_id
   where a.card_id=w.id and a.person_id is distinct from w.assignee_person and a.person_id is distinct from w.next_actor and btrim(coalesce(p.name,''))<>'';
  if names is not null then lines:=lines||('**Also assigned:** '||names)::text; end if;
  select string_agg('- ['||case when i.done then 'x' else ' ' end||'] '||replace(pg_temp.as_text(i.title),E'  \n',' '),E'\n' order by i.id) into items from public.work_checklist i where i.card_id=w.id;
  if array_length(lines,1) is null and items is null then continue; end if;
  block:=array_to_string(lines,E'\n\n')||case when items is not null then case when array_length(lines,1) is null then '' else E'\n\n' end||items else '' end;
  update public.work_cards x set description=case when btrim(x.description)='' then block else x.description||E'\n\n'||block end,
   description_version=x.description_version+1 where x.id=w.id;
 end loop;
 perform set_config('approval.internal','',true);
end $$;

-- 2. The previous release's own functions, and every function, trigger and default that kept stages, labels, the
-- checklist, the assignees list, next actor, mode or approval steps. Dropped before the columns and tables they read.
drop trigger if exists align_card_status on public.work_cards;
drop trigger if exists approval_card_guard on public.work_cards;
drop trigger if exists work_card_guard on public.work_cards;
drop trigger if exists schedule_approved_card on public.work_cards;
drop trigger if exists work_cards_review_from_steps on public.work_cards;
drop trigger if exists company_approval_defaults on public.companies;
drop trigger if exists company_work_defaults on public.companies;
drop function if exists public.align_card_status();
drop function if exists public.card_status_stage(uuid,text,bigint);
drop function if exists public.approval_card_guard();
drop function if exists public.approval_actor(uuid,bigint);
drop function if exists public.approval_holds(uuid,bigint);
drop function if exists public.approval_defaults();
drop function if exists public.backfill_review_approvals();
drop function if exists public.save_approval_step(uuid,bigint,text,integer,uuid,public.member_role);
drop function if exists public.remove_approval_step(uuid,bigint);
drop function if exists public.decide_approval(uuid,bigint,text,text,boolean,boolean);
drop function if exists public.review_from_steps();
drop function if exists public.schedule_approved_card();
drop function if exists public.work_guard();
drop function if exists public.work_defaults();
drop function if exists public.work_stage_column(uuid,text,text,integer);
drop function if exists public.required_work_stage(uuid,text);
drop function if exists public.move_work_card(uuid,bigint,bigint,text);
drop function if exists public.move_work_card_to_column(uuid,bigint,text,text);
drop function if exists public.place_work_card(uuid,bigint,text,bigint,text);
drop function if exists public.undo_work_card_move(uuid,bigint);
drop function if exists public.create_work_card(uuid,bigint,text,uuid);
drop function if exists public.create_work_card(uuid,bigint,text,text,text);
drop function if exists public.create_card_request(uuid,text,uuid,text);
drop function if exists public.agent_write(uuid,text,text,text,bigint,jsonb);
drop function if exists public.start_card_conversation(uuid,bigint,uuid);
drop function if exists public.assignee_from_list() cascade;

-- 3. The functions that read the old shapes, made again on the status, the one assignee and the description.

-- The Card's Agent column stays equal to its assignee Agent: a Card a chat, a channel or a Handover makes names its Agent
-- there, and an assignee written names it here.
create or replace function public.align_card_assignee()
 returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if (tg_op='INSERT' and num_nonnulls(new.assignee_agent,new.assignee_person)>0)
  or (tg_op='UPDATE' and (new.assignee_agent is distinct from old.assignee_agent or new.assignee_person is distinct from old.assignee_person)) then
  if new.assignee_person is not null and (tg_op='INSERT' or new.assignee_person is distinct from old.assignee_person)
   and not public.card_assignable(new.company_id,new.assignee_person) then raise exception 'assignee not a member' using errcode='22023'; end if;
  new.agent_id=new.assignee_agent;
 elsif tg_op='INSERT' or new.agent_id is distinct from old.agent_id then
  if new.agent_id is not null then new.assignee_agent=new.agent_id; new.assignee_person=null;
  elsif tg_op='UPDATE' then new.assignee_agent=null; end if;
 end if;
 return new;
end $function$;
drop trigger if exists align_card_assignee on public.work_cards;
create trigger align_card_assignee before insert or update of agent_id,assignee_agent,assignee_person on public.work_cards
 for each row execute function public.align_card_assignee();

-- The old guards held a Card's stage and approval to their functions; this one holds its status and its review the same
-- way: a person moves a Card with move_card and undo_card_move, sends it to review with ask_review and decides it with
-- decide_review, never by writing the row. A Card made by hand is not made waiting on a review or approved. Writes the
-- database makes for nobody (a Run's, a channel's, the cutover's own) pass.
create or replace function public.card_write_guard()
 returns trigger language plpgsql security definer set search_path='' as $function$
begin
 -- A Card never changes Company, whoever writes it (work_guard's first rule, kept).
 if tg_op='UPDATE' and new.company_id<>old.company_id then raise exception 'company cannot change' using errcode='42501'; end if;
 if auth.uid() is null or coalesce(current_setting('approval.internal',true),'')='yes' then return new; end if;
 if tg_op='INSERT' then
  if new.status='waiting' then raise exception 'waiting is not placed by hand' using errcode='42501'; end if;
  if num_nonnulls(new.approved_version,new.approved_at,new.review_submitter,new.review_entered_at,new.rejection_reason)>0 then
   raise exception 'approval fields are protected' using errcode='42501'; end if;
 else
  if new.status is distinct from old.status and coalesce(current_setting('work.move',true),'')<>'yes' then
   raise exception 'a card moves with move_card' using errcode='42501'; end if;
  if (new.approved_version,new.approved_at,new.review_submitter,new.review_entered_at,new.rejection_reason)
   is distinct from (old.approved_version,old.approved_at,old.review_submitter,old.review_entered_at,old.rejection_reason) then
   raise exception 'approval fields are protected' using errcode='42501'; end if;
 end if;
 return new;
end $function$;
revoke all on function public.card_write_guard() from public,anon,authenticated,service_role;
drop trigger if exists card_write_guard on public.work_cards;
create trigger card_write_guard before insert or update on public.work_cards for each row execute function public.card_write_guard();

-- A move is logged and remembered by its statuses.
create or replace function public.work_card_moved()
 returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if new.status is distinct from old.status and coalesce(current_setting('work.undo',true),'')<>'yes'
  and coalesce(current_setting('approval.internal',true),'')<>'yes' then
  insert into public.work_card_moves(company_id,card_id,person_id,from_place,to_place,from_status,to_status)
   values(new.company_id,new.id,auth.uid(),old.board_order,new.board_order,old.status,new.status);
 end if;
 return null;
end $function$;

-- A Card placed in a column lands at its end, unless its place is given.
create or replace function public.work_card_place()
 returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if coalesce(current_setting('work.place_exact',true),'')='yes' then return new; end if;
 if (tg_op='INSERT' and new.board_order is null) or (tg_op='UPDATE' and new.status is distinct from old.status) then
  new.board_order=coalesce((select max(w.board_order) from public.work_cards w where w.company_id=new.company_id and w.status=new.status and w.id<>coalesce(new.id,0)),0)+1;
 end if;
 return new;
end $function$;

-- The way back from a person's last move: its status and its exact place.
create or replace function public.undo_card_move(c uuid, card bigint)
 returns text language plpgsql set search_path='' as $function$
declare moved public.work_card_moves; now_status text; now_place numeric; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 select w.status,w.board_order into now_status,now_place from public.work_cards w where w.company_id=c and w.id=card for update;
 if not found then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 select m.* into moved from public.work_card_moves m where m.company_id=c and m.card_id=card and m.person_id=auth.uid() order by m.id desc limit 1;
 if not found then raise exception 'nothing to undo' using errcode='42501'; end if;
 if moved.id is distinct from public.work_card_latest_move(c,card) or now_status is distinct from moved.to_status or now_place is distinct from moved.to_place then
  raise exception 'the card moved on' using errcode='P0001';
 end if;
 perform public.check_card_move(c,card,moved.from_status);
 perform set_config('work.undo','yes',true);
 perform set_config('work.place_exact','yes',true);
 perform set_config('work.move','yes',true);
 update public.work_cards w set status=moved.from_status,board_order=moved.from_place where w.company_id=c and w.id=card;
 perform set_config('work.move','',true);
 perform set_config('work.place_exact','',true);
 perform set_config('work.undo','',true);
 return moved.from_status;
end $function$;

-- Every change to a Card, one row of its log; a move by its statuses. Rows already written keep their shapes.
create or replace function public.work_audit()
 returns trigger language plpgsql security definer set search_path='' as $function$
declare rowdata jsonb; previous jsonb; cid bigint; company uuid; field text; ev text; details jsonb; action_name text; begin
 rowdata=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 previous=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
 company=(rowdata->>'company_id')::uuid; cid=case when tg_table_name='work_cards' then (rowdata->>'id')::bigint else (rowdata->>'card_id')::bigint end;
 ev=nullif(current_setting('work.evidence',true),'');
 if tg_table_name='work_cards' and tg_op='UPDATE' then
  if new.assignee_agent is distinct from old.assignee_agent or new.assignee_person is distinct from old.assignee_person then
   insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),'card_changed',
    jsonb_build_object('field','assignee',
     'old',case when old.assignee_agent is not null then 'a:'||old.assignee_agent when old.assignee_person is not null then 'p:'||old.assignee_person end,
     'new',case when new.assignee_agent is not null then 'a:'||new.assignee_agent when new.assignee_person is not null then 'p:'||new.assignee_person end,
     'old_name',coalesce((select h.name from public.hermes_agents h where h.id=old.assignee_agent),(select p.name from public.people p where p.id=old.assignee_person)),
     'new_name',coalesce((select h.name from public.hermes_agents h where h.id=new.assignee_agent),(select p.name from public.people p where p.id=new.assignee_person)),
     'reason',nullif(current_setting('work.unassigned',true),'')),ev);
  end if;
  if new.status is distinct from old.status then
   insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),
    case when coalesce(current_setting('work.undo',true),'')='yes' then 'card_moved_back' else 'card_changed' end,
    jsonb_build_object('field','status','old_status',old.status,'new_status',new.status)
     ||case when coalesce(current_setting('work.undo',true),'')='yes' then jsonb_build_object('old_column',old.status,'new_column',new.status) else '{}'::jsonb end,ev);
  end if;
  foreach field in array array['title','go_live','project_id'] loop
   if rowdata->field is distinct from previous->field then
    details=jsonb_build_object('field',field,'old',previous->field,'new',rowdata->field);
    if field='project_id' then details=details || jsonb_build_object('old_name',(select name from public.work_projects where id=(previous->>'project_id')::bigint),'new_name',(select name from public.work_projects where id=(rowdata->>'project_id')::bigint)); end if;
    insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),'card_changed',details,ev);
   end if;
  end loop;
 else
  action_name=case tg_table_name when 'work_cards' then case when current_setting('work.idea',true)='yes' then 'idea_added' else 'card_created' end when 'work_creatives' then 'creative_added' when 'work_versions' then 'version_added' when 'work_comments' then 'comment_added' end;
  if tg_table_name='work_versions' then ev=coalesce(ev,rowdata->>'path'); end if;
  insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),action_name,rowdata,ev);
 end if; return coalesce(new,old); end $function$;

-- A Card's title, publishing date and Project, which the window saves.
create or replace function public.edit_work_card(c uuid, card bigint, fields jsonb, evidence text default null)
 returns void language plpgsql set search_path='' as $function$
declare pid bigint; begin
 if fields ? 'project_id' then
  pid=nullif(fields->>'project_id','')::bigint;
  if pid is not null and not exists(select 1 from public.work_projects p where p.company_id=c and p.id=pid) then raise exception 'project not found'; end if;
 end if;
 perform set_config('work.evidence',coalesce(evidence,''),true);
 update public.work_cards set title=coalesce(fields->>'title',title), project_id=case when fields ? 'project_id' then pid else project_id end,
  go_live=case when fields ? 'go_live' and date_trunc('minute',go_live) is distinct from date_trunc('minute',nullif(fields->>'go_live','')::timestamptz) then nullif(fields->>'go_live','')::timestamptz else go_live end
  where company_id=c and id=card;
 if not found then raise exception 'card not found or not permitted'; end if;
end $function$;

-- A comment, a design or a Version on a Card.
create or replace function public.change_work_card(c uuid, card bigint, operation text, payload jsonb, evidence text default null)
 returns bigint language plpgsql set search_path='' as $function$
declare result bigint; begin
 if not public.work_can_edit(c) then raise exception 'not permitted'; end if;
 -- Read as the caller: a Card its Agent hides from them answers as a Card that does not exist, as the Agent's own board
 -- write it replaces did (#228).
 if not exists(select 1 from public.work_cards w where w.company_id=c and w.id=card) then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 perform set_config('work.evidence',coalesce(evidence,''),true);
 case operation
 when 'comment' then insert into public.work_comments(company_id,card_id,body) values(c,card,payload->>'body') returning id into result;
 when 'creative' then insert into public.work_creatives(company_id,card_id,name) values(c,card,payload->>'name') returning id into result;
 when 'creative_with_version' then
  insert into public.work_creatives(company_id,card_id,name) values(c,card,payload->>'name') returning id into result;
  insert into public.work_versions(company_id,card_id,creative_id,path) values(c,card,result,payload->>'path');
 when 'version' then insert into public.work_versions(company_id,card_id,creative_id,path) values(c,card,(payload->>'creative')::bigint,payload->>'path') returning id into result;
 else raise exception 'unknown operation'; end case;
 if not found then raise exception 'card or item not found'; end if; return result;
end $function$;

-- Archiving a Card stops its work and ends its open review, unanswered (#681), so restoring it starts nothing.
create or replace function public.archive_cards(c uuid, cards bigint[])
 returns table(card bigint, archived_at timestamptz) language plpgsql security definer set search_path='' as $function$
declare w public.work_cards; stamp timestamptz; ended boolean;
begin
 if auth.uid() is null or not public.work_can_edit(c) then raise exception 'cardArchiveNotAllowed' using errcode='42501'; end if;
 -- One time for the whole call, the archive's version, taken from the clock and not the transaction, so two archives
 -- of one Card are never the same version.
 stamp:=clock_timestamp();
 for w in select * from public.work_cards x where x.company_id=c and x.id=any(cards) and x.archived_at is null order by x.id for update loop
  if not public.can_see_card(c,w.id) then continue; end if;
  perform public.stop_card_work(c,w.id);
  update public.work_reviews r set decision='ended',decided_by=auth.uid(),decided_at=now() where r.company_id=c and r.card_id=w.id and r.decision is null;
  ended:=found;
  update public.work_cards x set archived_at=stamp,archived_by=auth.uid() where x.company_id=c and x.id=w.id;
  insert into public.work_activity(company_id,card_id,actor_id,action,details)
   values(c,w.id,auth.uid(),'card_archived',jsonb_build_object('column',w.status)||case when ended then jsonb_build_object('approval','ended') else '{}'::jsonb end);
  card:=w.id; archived_at:=stamp;
  return next;
 end loop;
end $function$;

-- Restoring a Card starts nothing: one archived in review, whose review archiving ended, goes back to the column it
-- came to review from (In progress when none is remembered).
create or replace function public.restore_cards(c uuid, cards bigint[], archived timestamptz default null)
 returns setof bigint language plpgsql security definer set search_path='' as $function$
declare w public.work_cards; back text;
begin
 if auth.uid() is null or not public.work_can_edit(c) then raise exception 'cardRestoreNotAllowed' using errcode='42501'; end if;
 for w in select * from public.work_cards where company_id=c and id=any(cards) and archived_at is not null order by id for update loop
  if not public.can_see_card(c,w.id) or archived is not null and w.archived_at<>archived then continue; end if;
  back:=w.status;
  if w.status='waiting' and not exists(select 1 from public.work_reviews r where r.card_id=w.id and r.decision is null) then
   back:=coalesce((select m.from_status from public.work_card_moves m where m.company_id=c and m.card_id=w.id and m.to_status='waiting' and m.from_status in ('ideas','planned','progress') order by m.id desc limit 1),'progress');
  end if;
  perform set_config('work.move','yes',true);
  update public.work_cards set archived_at=null,archived_by=null,status=back where company_id=c and id=w.id;
  perform set_config('work.move','',true);
  insert into public.work_activity(company_id,card_id,actor_id,action,details)
   values(c,w.id,auth.uid(),'card_restored',jsonb_build_object('column',back));
  return next w.id;
 end loop;
end $function$;

-- What archiving a Card stops: its chat's and channel's work, its open Runs, and its open review.
create or replace function public.card_archive_stops(c uuid, cards bigint[])
 returns table(card bigint, title text, kind text, agent text, agent_id uuid) language sql stable security definer set search_path='' as $function$
 with chosen as (
  select w.id, w.title, w.company_id, w.conversation_id, w.channel_id from public.work_cards w
  where w.company_id=c and w.id=any(cards) and w.archived_at is null and auth.uid() is not null and public.is_member(c) and public.can_see_card(c,w.id)),
 found(id,title,kind,agent_id,agent_name) as (
  select w.id, w.title, s.kind, s.agent_id, s.agent_name
  from chosen w join public.conversations v on v.id=w.conversation_id and v.company_id=w.company_id
   cross join lateral public.conversation_work_stops(v.id) s
  union all
  select w.id, w.title, s.kind, s.agent_id, s.agent_name
  from chosen w join public.channels k on k.id=w.channel_id and k.company_id=w.company_id and public.in_channel(k.id)
   cross join lateral public.channel_work_stops(k.id) s
  union all
  select w.id, w.title, 'run', n.agent_id, n.agent_name
  from chosen w join public.note_runs n on n.company_id=w.company_id and n.card_id=w.id and n.outcome is null
  union all
  select w.id, w.title, 'approval', null::uuid, null::text
  from chosen w where exists(select 1 from public.work_reviews r where r.company_id=w.company_id and r.card_id=w.id and r.decision is null))
 -- Each Card's lines in its own order: who stops working, then what it asked, then the review.
 select d.* from (
  select distinct f.id, f.title, f.kind, x.agent_name, x.agent_id
  from found f cross join lateral (select case when seen then f.agent_name end, case when seen then f.agent_id end
   from (select f.agent_id is not null and public.can_see_agent(c,f.agent_id) as seen) v) x(agent_name,agent_id)) d
 order by d.id, array_position(array['run','question','permission','hand','approval'],d.kind), d.agent_name;
$function$;

-- The channel's Card as its members read it above the channel: its column and one line, the chat's wait while it
-- waits, or how far its to-do items are while it is in progress.
create or replace function public.channel_board_card(ch uuid)
 returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare k public.channels; w public.work_cards; right_now text; next_item text; total int; done int;
begin
 if ch is null or auth.uid() is null or not public.channel_member(ch,auth.uid()) then return null; end if;
 select * into k from public.channels where id=ch;
 if k.id is null then return null; end if;
 select * into w from public.work_cards where channel_id=ch and company_id=k.company_id and archived_at is null;
 if w.id is null or not public.can_see_agent(k.company_id,w.agent_id) then return null; end if;
 right_now:=case when public.card_wait(w) is not null then 'waiting' else w.status end;
 if right_now='waiting' then
  next_item:=public.card_wait(w)->>'title';
 elsif right_now='progress' then
  select count(*),count(*) filter (where t.done) into total,done from public.card_todos(w.description) t;
  if total>0 then select t.item into next_item from public.card_todos(w.description) t where not t.done order by t.line limit 1; end if;
 end if;
 return jsonb_build_object('card',w.id,'title',w.title,'column',right_now,
  'line',coalesce(case when right_now='progress' and total>0 and next_item is not null then next_item||' · '||round(100.0*done/total)::int||'%'
   when right_now='progress' and total>0 then round(100.0*done/total)::int||'%'
   when right_now='waiting' then next_item end,''),
  'waiting',right_now='waiting');
end $function$;

-- The review's decision, as #681 made it, writing no approval step or next actor.
create or replace function public.decide_review(c uuid, card bigint, version bigint, decision text, reason text default null)
returns text language plpgsql security definer set search_path='' as $$
declare w public.work_cards; r public.work_reviews; target text; begin
 if not public.can_manage_company(c) then raise exception 'not permitted' using errcode='42501'; end if;
 if decision not in ('approve','send_back') then raise exception 'invalid decision' using errcode='22023'; end if;
 if decision='send_back' and btrim(coalesce(reason,''))='' then raise exception 'reason required' using errcode='22023'; end if;
 select * into w from public.work_cards x where x.company_id=c and x.id=card for update;
 if not found or w.archived_at is not null or not public.can_see_card(c,card) then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 select * into r from public.work_reviews x where x.company_id=c and x.card_id=card and x.decision is null;
 if not found then raise exception 'review closed' using errcode='P0001'; end if;
 if r.version_id is distinct from version then raise exception 'version changed' using errcode='P0001'; end if;
 update public.work_reviews x set decision=case when decide_review.decision='approve' then 'approved' else 'sent_back' end,
  reason=nullif(btrim(coalesce(decide_review.reason,'')),''), decided_by=auth.uid(), decided_at=now() where x.id=r.id;
 target=case when decide_review.decision='send_back' then 'progress' when w.go_live is not null and w.go_live>now() then 'planned' else 'done' end;
 insert into public.work_activity(company_id,card_id,actor_id,action,details) values(c,card,auth.uid(),
  case when decide_review.decision='approve' then 'approval_approved' else 'approval_rejected' end,
  jsonb_build_object('version',version,'reason',nullif(btrim(coalesce(decide_review.reason,'')),'')));
 perform set_config('approval.internal','yes',true); perform set_config('work.move','yes',true);
 update public.work_cards x set status=target,
  approved_version=case when decide_review.decision='approve' then version end, approved_at=case when decide_review.decision='approve' then now() end,
  rejection_reason=case when decide_review.decision='send_back' then btrim(decide_review.reason) end
  where x.company_id=c and x.id=card;
 perform set_config('approval.internal','',true); perform set_config('work.move','',true);
 if decide_review.decision='send_back' then
  insert into public.work_comments(company_id,card_id,body,author_id) values(c,card,btrim(decide_review.reason),auth.uid());
 end if;
 return target;
end $$;

-- 4. The old shapes go. A move is remembered by its statuses alone. Safe to run again: a move is read from its stages
-- only while they are there, and each drop is of what is still there.
do $$ begin
 if to_regclass('public.work_stages') is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_card_moves' and column_name='from_stage_id') then
  update public.work_card_moves m set from_status=coalesce(m.from_status,s.board_column) from public.work_stages s where s.id=m.from_stage_id and m.from_status is null;
  update public.work_card_moves m set to_status=coalesce(m.to_status,s.board_column) from public.work_stages s where s.id=m.to_stage_id and m.to_status is null;
 end if;
end $$;
-- A move whose stage was deleted since has no column to go back to: Undo could never put it back, so it is no longer
-- remembered. The Card's log rows of it stay.
delete from public.work_card_moves where from_status is null or to_status is null;
alter table public.work_card_moves drop column if exists from_stage_id, drop column if exists to_stage_id;
alter table public.work_card_moves alter column from_status set not null, alter column to_status set not null;
alter table public.work_cards drop column if exists stage_id, drop column if exists next_actor, drop column if exists mode, drop column if exists approval_step_id,
 drop column if exists offering, drop column if exists segment, drop column if exists hook, drop column if exists channel, drop column if exists format,
 drop column if exists goal, drop column if exists caption;
drop table if exists public.work_card_labels;
drop table if exists public.work_labels;
drop table if exists public.work_checklist;
drop table if exists public.work_assignees;
drop table if exists public.approval_steps;
drop table if exists public.work_stages;
-- The stage table's own triggers went with it; their functions go now.
drop function if exists public.work_stage_place();
drop function if exists public.work_stage_key_guard();
drop function if exists public.guard_work_stage_kind();

-- The Cards a chat, a channel or a Handover makes land In progress by their status.
CREATE OR REPLACE FUNCTION public.lead_hand_to_agent(conversation uuid, run text, call text, agent_name text, goal text, context text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare talk public.conversations; target public.hermes_agents; handed public.agent_handovers; asker text; main boolean;
 card bigint; card_agent uuid; first_words text;
begin
 select * into talk from public.conversations where id=conversation for no key update;
 -- A call that cannot be carried out answers as a value, never an error: the run that made it still closes.
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  then return jsonb_build_object('state','refused'); end if;
 if talk.agent_id is null or not public.may_hand_to_agent(talk.company_id,talk.agent_id,talk.person_id)
  then return jsonb_build_object('state','refused'); end if;
 if exists(select 1 from public.stopped_runs s where s.conversation_id=conversation and s.run_id=run)
  then return jsonb_build_object('state','refused'); end if;
 if coalesce(agent_name,'') = '' or coalesce(goal,'') = '' then return jsonb_build_object('state','ignored'); end if;
 select * into target from public.hermes_agents a
  where a.company_id=talk.company_id and a.id<>talk.agent_id and a.profile is not null
   and lower(btrim(a.name))=lower(btrim(agent_name))
  order by a.id limit 1;
 if not found then return jsonb_build_object('state','ignored'); end if;
 insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,context)
  values(talk.company_id,conversation,run,call,talk.agent_id,target.id,btrim(goal),nullif(btrim(coalesce(context,'')),''))
  on conflict (conversation_id,run_id,call_id) do nothing returning * into handed;
 -- The same call again keeps nothing twice: one handover, and so one Card and one log row.
 if handed.id is not null then
  main:=public.is_company_lead(talk.company_id,talk.agent_id);
  select w.id,w.agent_id into card,card_agent from public.work_cards w where w.company_id=talk.company_id and w.conversation_id=conversation;
  if card is null and main then
   -- As #144's Card: In progress, titled from the person's first message in this chat.
    select m.body into first_words from public.conversation_messages m where m.conversation_id=conversation and m.author='person' order by m.id limit 1;
    insert into public.work_cards(company_id,status,title,agent_id,conversation_id)
     values(talk.company_id,'progress',public.chat_card_title(first_words,target.name),target.id,conversation)
     on conflict (conversation_id) where conversation_id is not null do nothing returning id into card;
    -- #354: when two handovers race, the second insert finds the first's Card and takes it, giving it the Agent it
    -- handed the work to as a later handover does, and keeping that Card's status and title.
    if card is null then
     select w.id into card from public.work_cards w where w.company_id=talk.company_id and w.conversation_id=conversation;
     if card is not null then
      update public.work_cards set agent_id=target.id
       where company_id=talk.company_id and id=card and agent_id is distinct from target.id and archived_at is null; end if;
    end if;
  elsif card is not null and main and card_agent is distinct from target.id then
   update public.work_cards set agent_id=target.id where company_id=talk.company_id and id=card and archived_at is null;
  end if;
  if card is not null then
   select a.name into asker from public.hermes_agents a where a.company_id=talk.company_id and a.id=talk.agent_id;
   -- The one who handed the work is the row's actor and the Agent it went to is the Agent the row is about, so a Member
   -- who does not see either one reads no row (company_log_read) and no name in the Card's crew (crew).
   insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
    values(talk.company_id,talk.agent_id,'agent',asker,'card',card,target.id,'agent_handed_to',
     jsonb_build_object('agent_name',asker,'to_name',target.name,'goal',handed.goal),'agent_handovers',handed.id,handed.created_at)
    on conflict (source,source_id) do nothing;
  end if;
 end if;
 return jsonb_build_object('state','created','agent',target.name);
end $function$;

CREATE OR REPLACE FUNCTION public.conversation_reply_card()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare chat public.conversations; agent public.hermes_agents; asked public.conversation_messages; card bigint;
begin
 select * into chat from public.conversations where id=new.conversation_id;
 select * into agent from public.hermes_agents where id=chat.agent_id and company_id=chat.company_id;
 if not found or agent.is_default then return null; end if;
 select * into asked from public.conversation_messages where conversation_id=chat.id and author='person' order by id limit 1;
 if asked.run_id is distinct from new.run_id
  or exists(select 1 from public.agent_rules where conversation_id=chat.id and run_id=new.run_id)
  or exists(select 1 from public.lead_made_agents where conversation_id=chat.id and run_id=new.run_id)
  or exists(select 1 from public.lead_agent_requests where conversation_id=chat.id and run_id=new.run_id) then return null; end if;
 insert into public.work_cards(company_id,status,title,agent_id,conversation_id)
  values(chat.company_id,'progress',public.chat_card_title(asked.body,agent.name),agent.id,chat.id)
  on conflict (conversation_id) where conversation_id is not null do nothing returning id into card;
 if card is not null then
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
   select h.company_id,h.from_agent,'agent',f.name,'card',card,h.to_agent,'agent_handed_to',
    jsonb_build_object('agent_name',f.name,'to_name',t.name,'goal',h.goal),'agent_handovers',h.id,h.created_at
   from public.agent_handovers h
    join public.hermes_agents f on f.id=h.from_agent and f.company_id=h.company_id
    join public.hermes_agents t on t.id=h.to_agent and t.company_id=h.company_id
   where h.conversation_id=chat.id and h.company_id=chat.company_id
   order by h.id
   on conflict (source,source_id) do nothing;
 end if;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.channel_run_card()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k public.channels; made public.work_cards; line bigint;
begin
 select * into k from public.channels where id=new.channel_id and company_id=new.company_id;
 if k.id is null or k.kind<>'team' then return null; end if;
 insert into public.work_cards(company_id,status,title,agent_id,channel_id)
  values (k.company_id,'progress',coalesce(k.name,''),new.agent_id,k.id)
  on conflict (channel_id) where channel_id is not null do nothing returning * into made;
 if made.id is null then return null; end if;
 insert into public.channel_notes(company_id,channel_id,kind,card_id,actor_name)
  values (k.company_id,k.id,'card',made.id,'') on conflict (card_id) where card_id is not null do nothing returning id into line;
 insert into public.company_log(company_id,actor_id,actor_kind,subject,card_id,action,details,source,source_id,created_at)
  values (k.company_id,null,'system','card',made.id,'channel_card_added',
   jsonb_build_object('channel_id',k.id,'channel',k.name),'channel_cards',made.id,now())
  on conflict (source,source_id) do nothing;
 return null;
end $function$;
