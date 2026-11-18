-- An idea added in the Ideas column (#188). A Card can carry an Agent (#20), and the column's form names the one the
-- person chose; the server refuses an Agent hidden from that person or of another Company, and a Viewer by the same rule
-- every Card creation follows (work_can_edit). Only the new overload is added, so the previous app version keeps calling
-- create_work_card(c,s,title,template,evidence) as before.
create function public.create_work_card(c uuid, s bigint, card_title text, agent uuid) returns bigint language plpgsql security invoker set search_path='' as $$
declare result bigint; begin
 if not public.work_can_edit(c) then raise exception 'not permitted'; end if;
 if btrim(coalesce(card_title,''))='' then raise exception 'invalid idea' using errcode='22023'; end if;
 -- The form adds to Ideas, whatever stage the caller names.
 if not exists(select 1 from public.work_stages where company_id=c and id=s and kind='ideas') then raise exception 'no Ideas stage'; end if;
 -- An Agent of this Company that this person sees: another Company's is not found, and a hidden one is not found.
 if agent is null or not exists(select 1 from public.hermes_agents h where h.company_id=c and h.id=agent)
  or not public.agent_visible_to(c,auth.uid(),agent) then raise exception 'agent not found'; end if;
 -- The Card's own log row says it was an idea, as the reference's saveIdea logs "added an idea".
 perform set_config('work.idea','yes',true);
 insert into public.work_cards(company_id,stage_id,title,agent_id) values(c,s,card_title,agent) returning id into result;
 perform set_config('work.idea','',true);
 return result;
end $$;
revoke all on function public.create_work_card(uuid,bigint,text,uuid) from public,anon;
grant execute on function public.create_work_card(uuid,bigint,text,uuid) to authenticated;

-- The Card's own activity row distinguishes an idea from another Card (20261118000000_projects's work_audit, unchanged else).
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
    if field='stage_id' then details=details || jsonb_build_object('old_name',(select name from public.work_stages where id=(previous->>'stage_id')::bigint),'new_name',(select name from public.work_stages where id=(rowdata->>'stage_id')::bigint)); end if;
    if field='project_id' then details=details || jsonb_build_object('old_name',(select name from public.work_projects where id=(previous->>'project_id')::bigint),'new_name',(select name from public.work_projects where id=(rowdata->>'project_id')::bigint)); end if;
    insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),'card_changed',details,ev);
   end if;
  end loop;
 else
  action_name=case tg_table_name when 'work_cards' then case when current_setting('work.idea',true)='yes' then 'idea_added' else 'card_created' end when 'work_checklist' then 'checklist_changed' when 'work_card_labels' then 'label_changed' when 'work_assignees' then 'assignee_changed' when 'work_creatives' then 'creative_added' when 'work_versions' then 'version_added' when 'work_comments' then 'comment_added' end;
  if tg_table_name='work_versions' then ev=coalesce(ev,rowdata->>'path'); end if;
  insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),action_name,rowdata,ev);
 end if; return coalesce(new,old); end $$;
