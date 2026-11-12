-- Files and reference images attached to the messages of a card. The bytes stay in the company's folder of the private
-- `creatives` bucket; this table names them, so a person or an agent reads a file by its id and never by a storage path.
alter table public.work_comments add constraint work_comments_card_identity unique (company_id, card_id, id);
create table public.work_attachments (
 id bigint generated always as identity primary key,
 company_id uuid not null,
 card_id bigint not null,
 comment_id bigint not null,
 name text not null check (length(name) between 1 and 255),
 content_type text not null check (length(content_type) between 1 and 127),
 size bigint not null check (size between 1 and 20971520),
 path text not null check (split_part(path,'/',1)=company_id::text),
 created_by uuid not null default auth.uid() references public.people(id),
 created_at timestamptz not null default now(),
 foreign key (company_id, card_id) references public.work_cards(company_id, id),
 foreign key (company_id, card_id, comment_id) references public.work_comments(company_id, card_id, id),
 unique (company_id, path)
);
create index work_attachments_card on public.work_attachments(company_id, card_id);
alter table public.work_attachments enable row level security;
-- A run key's internal token names its one card; the database shows it that card's files only, as the route does.
create policy attachments_read on public.work_attachments for select to authenticated using ((public.is_member(company_id) or public.agency_access()) and (auth.jwt()->>'run_card' is null or card_id=(auth.jwt()->>'run_card')::bigint));
create policy attachments_insert on public.work_attachments for insert to authenticated with check (public.work_can_edit(company_id) and created_by=auth.uid());
revoke all on public.work_attachments from public, anon, authenticated;
grant select, insert on public.work_attachments to authenticated;

-- Attach files already stored in the company's folder to a message of a card (the first message when none is named).
-- A file that is not stored in a folder the caller can read is skipped, and a file already attached is not attached twice, so a retry is safe.
create function public.attach_files(c uuid, card bigint, message bigint, files jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare target bigint; added integer; begin
 if not public.work_can_edit(c) then raise exception 'not permitted'; end if;
 if jsonb_typeof(files) is distinct from 'array' then raise exception 'invalid files' using errcode='22023'; end if;
 if jsonb_array_length(files) not between 1 and 5 then raise exception 'invalid files' using errcode='22023'; end if;
 select m.id into target from public.work_comments m where m.company_id=c and m.card_id=card and (attach_files.message is null or m.id=attach_files.message) order by m.id limit 1;
 if target is null then raise exception 'card or message not found'; end if;
 insert into public.work_attachments(company_id,card_id,comment_id,name,content_type,size,path)
  select c, card, target, f.name, f.content_type, f.size, f.path
  from jsonb_to_recordset(files) as f(name text, content_type text, size bigint, path text)
  where exists(select 1 from storage.objects o where o.bucket_id='creatives' and o.name=f.path)
  on conflict (company_id, path) do nothing;
 get diagnostics added = row_count;
 return added;
end $$;
revoke all on function public.attach_files(uuid,bigint,bigint,jsonb) from public, anon;
grant execute on function public.attach_files(uuid,bigint,bigint,jsonb) to authenticated;
