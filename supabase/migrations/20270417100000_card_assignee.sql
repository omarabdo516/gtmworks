-- #677 (spec #668, ADR 0026): a Card has at most one assignee, an Agent or a Member who is not a Viewer. This is the
-- first step of ADR 0023: it adds the assignee and copies the previous release's shapes into it (the Card's Agent, its
-- next actor, its assignees list and, for a Card in review, the one who sent it there); nothing is dropped here. The
-- cutover (#684) drops the old shapes once this release answers.
--
-- Both shapes stay written by one trigger: an assignee written (this release) writes the Agent and the next actor, and
-- the Agent or next actor written (the previous release, the triggers that make a Card from a chat, a channel or a
-- Handover) moves the assignee. Removing an Agent or a Member, or making a Member a Viewer, leaves their Cards assigned
-- to nobody in their columns, with a log row saying why. Assigning an Agent starts nothing yet: the Agent is still
-- called with "@" in a comment, as today, until the spec "Agents work Cards".

-- 1. The assignee: an Agent, a Member, or nobody; never two.
alter table public.work_cards add column assignee_agent uuid, add column assignee_person uuid,
 add constraint work_cards_one_assignee check (num_nonnulls(assignee_agent,assignee_person)<=1),
 add constraint work_cards_assignee_agent_fkey foreign key (company_id,assignee_agent) references public.hermes_agents(company_id,id) on delete set null (assignee_agent),
 add constraint work_cards_assignee_person_fkey foreign key (company_id,assignee_person) references public.members(company_id,person_id) on delete set null (assignee_person);
create index work_cards_assignee_agent on public.work_cards(company_id,assignee_agent) where assignee_agent is not null;
create index work_cards_assignee_person on public.work_cards(company_id,assignee_person) where assignee_person is not null;

-- 2. Who can be a Card's assignee among people: a Member of the Company who is not a Viewer.
create function public.card_assignable(c uuid, person uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.removed_at is null and m.role<>'viewer');
$$;
revoke all on function public.card_assignable(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.card_assignable(uuid,uuid) to authenticated;

-- 3. Every Card's assignee from its old shapes: its Agent; else, in review, the one who sent it there; else its next
-- actor; else the first of its assignees. A person who is no assignee (a Viewer, someone removed) is skipped.
update public.work_cards w set assignee_agent=w.agent_id where w.agent_id is not null;
update public.work_cards w set assignee_person=(select v.person from (values
  (1,case when w.approval_step_id is not null then w.review_submitter end),
  (2,case when w.approval_step_id is null then w.next_actor end),
  (3,(select a.person_id from public.work_assignees a where a.company_id=w.company_id and a.card_id=w.id and public.card_assignable(w.company_id,a.person_id) order by a.id limit 1))) v(n,person)
 where v.person is not null and public.card_assignable(w.company_id,v.person) order by v.n limit 1)
 where w.agent_id is null;

-- 4. Both shapes, kept equal. The trigger fires only for the columns a statement names, so the next actor an approval
-- step writes on entering review (approval_card_guard) is no assignee; while a Card is in review its next actor stays
-- the approval's.
create function public.align_card_assignee() returns trigger language plpgsql security definer set search_path='' as $$
declare in_review boolean := new.approval_step_id is not null or (tg_op='UPDATE' and old.approval_step_id is not null); begin
 if (tg_op='INSERT' and num_nonnulls(new.assignee_agent,new.assignee_person)>0)
  or (tg_op='UPDATE' and (new.assignee_agent is distinct from old.assignee_agent or new.assignee_person is distinct from old.assignee_person)) then
  if new.assignee_person is not null and (tg_op='INSERT' or new.assignee_person is distinct from old.assignee_person)
   and not public.card_assignable(new.company_id,new.assignee_person) then raise exception 'assignee not a member' using errcode='22023'; end if;
  new.agent_id=new.assignee_agent;
  if not in_review then new.next_actor=new.assignee_person; end if;
 else
  if tg_op='INSERT' or new.agent_id is distinct from old.agent_id then
   if new.agent_id is not null then new.assignee_agent=new.agent_id; new.assignee_person=null;
   elsif tg_op='UPDATE' then new.assignee_agent=null; end if;
  end if;
  if (tg_op='INSERT' or new.next_actor is distinct from old.next_actor) and new.assignee_agent is null and not in_review then
   new.assignee_person=case when new.next_actor is not null and public.card_assignable(new.company_id,new.next_actor) then new.next_actor end;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.align_card_assignee() from public,anon,authenticated,service_role;
create trigger align_card_assignee before insert or update of agent_id,next_actor,assignee_agent,assignee_person on public.work_cards
 for each row execute function public.align_card_assignee();

-- The first assignee the previous release adds to a Card nobody has becomes its assignee. This release writes nothing
-- into that list: the previous release reads a Card's person from its next actor, and a row copied there would refuse
-- the same person added by the previous release (one row per person).
create function public.assignee_from_list() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if public.card_assignable(new.company_id,new.person_id) then
  update public.work_cards set assignee_person=new.person_id
   where company_id=new.company_id and id=new.card_id and assignee_agent is null and assignee_person is null;
 end if;
 return null;
end $$;
revoke all on function public.assignee_from_list() from public,anon,authenticated,service_role;
create trigger assignee_from_list after insert on public.work_assignees
 for each row execute function public.assignee_from_list();

-- 5. Removing an Agent or a Member, or making a Member a Viewer, leaves their Cards assigned to nobody, in their
-- columns; the log row says why (work.unassigned). The Agent's Cards are let go before the Agent goes, so the row still
-- names it.
create function public.unassign_removed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='hermes_agents' then
  perform set_config('work.unassigned','agent_removed',true);
  update public.work_cards set assignee_agent=null where company_id=old.company_id and assignee_agent=old.id;
  perform set_config('work.unassigned','',true);
  return old;
 end if;
 if (new.removed_at is not null and old.removed_at is null) or (new.removed_at is null and new.role='viewer' and old.role is distinct from 'viewer') then
  perform set_config('work.unassigned',case when new.removed_at is not null then 'member_removed' else 'member_viewer' end,true);
  update public.work_cards set assignee_person=null where company_id=new.company_id and assignee_person=new.person_id;
  perform set_config('work.unassigned','',true);
 end if;
 return null;
end $$;
revoke all on function public.unassign_removed() from public,anon,authenticated,service_role;
create trigger unassign_removed_agent before delete on public.hermes_agents
 for each row execute function public.unassign_removed();
-- On every update, not "of removed_at, role": a trigger naming the role column would stop any later change of its type.
create trigger unassign_removed_member after update on public.members
 for each row execute function public.unassign_removed();

-- The Agent a Card was made with is kept as its Agent is removed (#702, keep_record_agent): letting the Card go from the
-- removed Agent here (work.unassigned) is that removal, not a person letting the Agent go, so the Card keeps its face.
create or replace function public.keep_record_agent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.agent_id is not null then new.kept_agent_id:=new.agent_id;
 elsif tg_op='INSERT' or (exists(select 1 from public.hermes_agents a where a.id=old.agent_id)
  and coalesce(current_setting('work.unassigned',true),'')<>'agent_removed') then new.kept_agent_id:=null;
 else new.kept_agent_id:=old.kept_agent_id; end if;
 return new;
end $$;

-- 6. The log: one row for an assignee changed, naming both and why it changed when nobody chose it; the next actor
-- this release writes beside it has no row of its own.
create or replace function public.work_audit()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare rowdata jsonb; previous jsonb; cid bigint; company uuid; field text; ev text; details jsonb; action_name text; assignee_moved boolean; begin
 rowdata=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 previous=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
 company=(rowdata->>'company_id')::uuid; cid=case when tg_table_name='work_cards' then (rowdata->>'id')::bigint else (rowdata->>'card_id')::bigint end;
 ev=nullif(current_setting('work.evidence',true),'');
 if tg_table_name='work_cards' and tg_op='UPDATE' then
  assignee_moved=new.assignee_agent is distinct from old.assignee_agent or new.assignee_person is distinct from old.assignee_person;
  if assignee_moved then
   insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),'card_changed',
    jsonb_build_object('field','assignee',
     'old',case when old.assignee_agent is not null then 'a:'||old.assignee_agent when old.assignee_person is not null then 'p:'||old.assignee_person end,
     'new',case when new.assignee_agent is not null then 'a:'||new.assignee_agent when new.assignee_person is not null then 'p:'||new.assignee_person end,
     'old_name',coalesce((select h.name from public.hermes_agents h where h.id=old.assignee_agent),(select p.name from public.people p where p.id=old.assignee_person)),
     'new_name',coalesce((select h.name from public.hermes_agents h where h.id=new.assignee_agent),(select p.name from public.people p where p.id=new.assignee_person)),
     'reason',nullif(current_setting('work.unassigned',true),'')),ev);
  end if;
  foreach field in array array['title','stage_id','offering','segment','hook','channel','format','go_live','goal','caption','next_actor','project_id'] loop
   if rowdata->field is distinct from previous->field and not (field='next_actor' and assignee_moved) then
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

-- 7. Who sees a Card: everyone in the Company but those its assignee Agent is hidden from. A Card assigned to a Member
-- has no Agent, so that Member always sees it; the Agent of the chat it came from no longer hides it (its chat stays
-- that person's own, card_chat_person).
create or replace function public.can_see_card(c uuid, card bigint)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
 select coalesce((select w.assignee_agent is null or public.can_see_agent(c,w.assignee_agent)
  from public.work_cards w where w.company_id=c and w.id=card),true);
$function$;

drop policy card_agent_visible on public.work_cards;
create policy card_agent_visible on public.work_cards as restrictive for select to authenticated
 using (assignee_agent is null or public.can_see_agent(company_id,assignee_agent));

create or replace function public.board_cards(c uuid)
 returns setof public.work_cards
 language sql
 stable
 set search_path to ''
as $function$
 select w.* from public.work_cards w where w.company_id=c and public.can_see_agent(c,w.assignee_agent);
$function$;

-- 8. This release's one way to assign: an Agent the person sees, a Member who is not a Viewer, or nobody. "Assign to me"
-- is the caller's own id. It starts nothing.
create function public.assign_card(c uuid, card bigint, agent uuid default null, person uuid default null)
returns void language plpgsql set search_path='' as $$
declare changed integer; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 if agent is not null and person is not null then raise exception 'one assignee' using errcode='22023'; end if;
 if agent is not null and (not exists(select 1 from public.hermes_agents h where h.company_id=c and h.id=agent) or not public.can_see_agent(c,agent)) then
  raise exception 'agent not found' using errcode='P0002'; end if;
 if person is not null and not public.card_assignable(c,person) then raise exception 'assignee not a member' using errcode='22023'; end if;
 update public.work_cards w set assignee_agent=agent, assignee_person=person where w.company_id=c and w.id=card;
 get diagnostics changed=row_count;
 if changed=0 then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
end $$;
revoke all on function public.assign_card(uuid,bigint,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assign_card(uuid,bigint,uuid,uuid) to authenticated;
