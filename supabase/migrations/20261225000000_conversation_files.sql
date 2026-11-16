-- #21: the files of a Conversation, which the Agent details panel lists beside the files of the Agent's Cards
-- (work_attachments). The bytes stay in the Company's folder of the private `creatives` bucket and this table names them,
-- under <company>/conversations/<conversation>/, so a file is opened by its id and never by its storage path. A Conversation is private to the person who started it,
-- so its files are too: only that person reads them, while they are a Member who sees the Conversation's Agent, as
-- conversations_read and conversation_messages_read decide for the Conversation itself.
--
-- Nothing writes these rows yet: no policy lets a signed-in person insert, change or delete one, and no function adds
-- one. The table starts empty, so nothing existing is rewritten, and the previous app version never reads it.
create table public.conversation_attachments (
 id bigint generated always as identity primary key,
 company_id uuid not null,
 conversation_id uuid not null,
 name text not null check (length(name) between 1 and 255),
 content_type text not null check (length(content_type) between 1 and 127),
 size bigint not null check (size between 1 and 20971520),
 path text not null check (split_part(path,'/',1)=company_id::text and split_part(path,'/',2)='conversations' and split_part(path,'/',3)=conversation_id::text),
 created_at timestamptz not null default now(),
 foreign key (conversation_id, company_id) references public.conversations(id, company_id),
 unique (company_id, path)
);
create index conversation_attachments_conversation on public.conversation_attachments(company_id, conversation_id);
alter table public.conversation_attachments enable row level security;
create policy conversation_attachments_read on public.conversation_attachments for select to authenticated using (exists(
 select 1 from public.conversations c where c.id=conversation_attachments.conversation_id and c.company_id=conversation_attachments.company_id
  and c.person_id=auth.uid() and public.is_member(c.company_id) and public.can_see_agent(c.company_id,c.agent_id)));
revoke all on public.conversation_attachments from public, anon, authenticated, service_role;
grant select on public.conversation_attachments to authenticated;

-- The bytes are as private as the row. The Company-wide rules on the bucket skip the conversations folder, so a Member who
-- learns a path reads nothing there; only the Conversation's own person reads its folder, under the same conditions as
-- the row. Card files never use that folder: their second folder is a Card number or a random id.
alter policy creative_read on storage.objects using (bucket_id='creatives' and (storage.foldername(name))[2] is distinct from 'conversations'
 and public.is_member(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then (storage.foldername(name))[1]::uuid end));
alter policy creative_write on storage.objects with check (bucket_id='creatives' and (storage.foldername(name))[2] is distinct from 'conversations'
 and public.work_can_edit(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then (storage.foldername(name))[1]::uuid end));
create policy conversation_file_read on storage.objects for select to authenticated using (bucket_id='creatives' and (storage.foldername(name))[2]='conversations'
 and exists(select 1 from public.conversations c where c.id::text=(storage.foldername(name))[3] and c.company_id::text=(storage.foldername(name))[1]
  and c.person_id=auth.uid() and public.is_member(c.company_id) and public.can_see_agent(c.company_id,c.agent_id)));
