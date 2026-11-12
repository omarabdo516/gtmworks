-- A project groups the cards of one company goal. A card belongs to at most one project, and only to a project of its own company.
create table public.work_projects (id bigint generated always as identity primary key, company_id uuid not null references public.companies(id), name text not null check (btrim(name)<>''), goal text not null default '', status text not null default 'active' check (status in ('active','paused','done')), created_at timestamptz not null default now(), unique(company_id,id));
alter table public.work_cards add column project_id bigint;
-- The pair (company, project) must exist together, so a card of company A cannot point at a project of company B even through a direct write.
alter table public.work_cards add constraint work_cards_project_fk foreign key (company_id,project_id) references public.work_projects(company_id,id);
create index work_cards_project on public.work_cards(company_id,project_id);
alter table public.work_projects enable row level security;
create policy work_read on public.work_projects for select to authenticated using (public.is_member(company_id) or public.agency_access());
create policy work_write on public.work_projects for all to authenticated using (public.work_can_edit(company_id)) with check (public.work_can_edit(company_id));
-- New tables carry no client access until granted. A project never changes company: only these three columns can be updated.
grant select, insert on public.work_projects to authenticated;
grant update (name,goal,status) on public.work_projects to authenticated;

-- Filing a card is an edit with a project_id (an empty value takes it out of its project). The same function serves the card page and the agents' API.
create or replace function public.edit_work_card(c uuid, card bigint, fields jsonb, evidence text default null) returns void language plpgsql security invoker set search_path='' as $$ declare pid bigint; begin
 if fields ? 'project_id' then
  pid=nullif(fields->>'project_id','')::bigint;
  if pid is not null and not exists(select 1 from public.work_projects p where p.company_id=c and p.id=pid) then raise exception 'project not found'; end if;
 end if;
 perform set_config('work.evidence',coalesce(evidence,''),true); update public.work_cards set title=coalesce(fields->>'title',title), offering=coalesce(fields->>'offering',offering), segment=coalesce(fields->>'segment',segment), hook=coalesce(fields->>'hook',hook), channel=coalesce(fields->>'channel',channel), format=coalesce(fields->>'format',format), goal=coalesce(fields->>'goal',goal), caption=coalesce(fields->>'caption',caption), project_id=case when fields ? 'project_id' then pid else project_id end, go_live=case when fields ? 'go_live' and date_trunc('minute',go_live) is distinct from date_trunc('minute',nullif(fields->>'go_live','')::timestamptz) then nullif(fields->>'go_live','')::timestamptz else go_live end where company_id=c and id=card; if not found then raise exception 'card not found or not permitted'; end if; end $$;

-- The card's activity records the change of project with both names.
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
  action_name=case tg_table_name when 'work_cards' then 'card_created' when 'work_checklist' then 'checklist_changed' when 'work_card_labels' then 'label_changed' when 'work_assignees' then 'assignee_changed' when 'work_creatives' then 'creative_added' when 'work_versions' then 'version_added' when 'work_comments' then 'comment_added' end;
  if tg_table_name='work_versions' then ev=coalesce(ev,rowdata->>'path'); end if;
  insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),action_name,rowdata,ev);
 end if; return coalesce(new,old); end $$;
