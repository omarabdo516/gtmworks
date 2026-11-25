-- #678 (spec #668, ADR 0026): the Card window. Each property saves by itself as it changes, and a save states the value
-- it read: when someone changed that value meanwhile, the save is refused and answers the newer value, which the window
-- shows in its place. Files go on the Card itself, beside the files on its comments. Only adds (ADR 0023): the previous
-- release keeps writing its own shapes, and a file it never wrote (one under no comment) is left out of what it reads.

-- 1. A file on the Card belongs to no comment.
alter table public.work_attachments alter column comment_id drop not null;

-- 2. One property of a Card, saved over the value its writer read. The values are text as the window holds them: the
-- title, the publishing date as a day (YYYY-MM-DD, '' for none), the Project's id ('' for none) and the assignee
-- ('a:<Agent>', 'p:<Member>', '' for nobody). The rules are the ones each save already had: edit_work_card for the title,
-- the date and the Project, assign_card for the assignee. Runs as the caller, so a Card hidden from them, archived, or
-- of another Company is not found.
create function public.card_value(w public.work_cards, field text)
returns text language sql stable set search_path='' as $$
 select case field
  when 'title' then w.title
  when 'go_live' then coalesce(to_char(w.go_live at time zone 'UTC','YYYY-MM-DD'),'')
  when 'project' then coalesce(w.project_id::text,'')
  when 'assignee' then case when w.assignee_person is not null then 'p:'||w.assignee_person when w.assignee_agent is not null then 'a:'||w.assignee_agent else '' end
 end;
$$;
revoke all on function public.card_value(public.work_cards,text) from public,anon,authenticated,service_role;
grant execute on function public.card_value(public.work_cards,text) to authenticated;

create function public.save_card(c uuid, card bigint, field text, value text, seen text)
returns jsonb language plpgsql set search_path='' as $$
declare w public.work_cards; current text; kind text; who uuid; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 if field not in ('title','go_live','project','assignee') then raise exception 'unknown field' using errcode='22023'; end if;
 select * into w from public.work_cards x where x.company_id=c and x.id=card for update;
 if not found then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 current=public.card_value(w,field);
 if current is distinct from coalesce(seen,'') then return jsonb_build_object('saved',false,'value',current); end if;
 if field='title' then
  if btrim(coalesce(value,''))='' then raise exception 'title required' using errcode='22023'; end if;
  perform public.edit_work_card(c,card,jsonb_build_object('title',btrim(value)));
 elsif field='go_live' then
  if coalesce(value,'')<>'' and value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid date' using errcode='22023'; end if;
  perform public.edit_work_card(c,card,jsonb_build_object('go_live',case when coalesce(value,'')='' then '' else value||'T00:00:00Z' end));
 elsif field='project' then
  if coalesce(value,'')<>'' and value !~ '^\d{1,18}$' then raise exception 'project not found'; end if;
  perform public.edit_work_card(c,card,jsonb_build_object('project_id',coalesce(value,'')));
 else
  kind=split_part(coalesce(value,''),':',1);
  if coalesce(value,'')<>'' and (kind not in ('a','p') or split_part(value,':',2) !~ '^[0-9a-f-]{36}$') then raise exception 'assignee not a member' using errcode='22023'; end if;
  who=nullif(split_part(coalesce(value,''),':',2),'')::uuid;
  perform public.assign_card(c,card,case when kind='a' then who end,case when kind='p' then who end);
 end if;
 select * into w from public.work_cards x where x.company_id=c and x.id=card;
 return jsonb_build_object('saved',true,'value',public.card_value(w,field));
end $$;
revoke all on function public.save_card(uuid,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.save_card(uuid,bigint,text,text,text) to authenticated;

-- 3. Files added to the Card itself (the window's Files row), stored first in the Card's folder, as a comment's are.
create function public.attach_card_files(c uuid, card bigint, files jsonb)
returns integer language plpgsql set search_path='' as $$
declare added integer; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 if jsonb_typeof(files) is distinct from 'array' or jsonb_array_length(files) not between 1 and 5 then raise exception 'invalid files' using errcode='22023'; end if;
 perform 1 from public.work_cards x where x.company_id=c and x.id=card;
 if not found then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 insert into public.work_attachments(company_id,card_id,comment_id,name,content_type,size,path)
  select c, card, null, f.name, f.content_type, f.size, f.path
  from jsonb_to_recordset(files) as f(name text, content_type text, size bigint, path text)
  where exists(select 1 from storage.objects o where o.bucket_id='creatives' and o.name=f.path)
  on conflict (company_id, path) do nothing;
 get diagnostics added = row_count;
 return added;
end $$;
revoke all on function public.attach_card_files(uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.attach_card_files(uuid,bigint,jsonb) to authenticated;

-- 4. Files added to a Card are a row of its log, one per adding, naming them; a comment's files are told by the comment.
create function public.log_card_files()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.work_activity(company_id,card_id,actor_id,action,details)
  select a.company_id,a.card_id,auth.uid(),'files_added',jsonb_build_object('names',jsonb_agg(a.name order by a.id))
  from added a where a.comment_id is null group by a.company_id,a.card_id;
 return null;
end $$;
revoke all on function public.log_card_files() from public,anon,authenticated,service_role;
create trigger work_attachments_card_files after insert on public.work_attachments referencing new table as added for each statement execute function public.log_card_files();
