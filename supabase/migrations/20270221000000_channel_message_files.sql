-- #156: an image a person attaches to a channel message is kept with it, under the send key and the message it was sent
-- with, and every Member of that channel reads it, a Viewer included. A message that calls an Agent gives its Run the
-- images; a message that calls no Agent keeps them under its own turn, with no Run. The bytes stay in the Company's
-- folder of the private `creatives` bucket under <company>/channels/<channel>/, as a Conversation's do under
-- <company>/conversations/<conversation>/ (#155).
--
-- Additive: one new table, two functions, one storage read policy, and one length check loosened on a message's body and
-- in post_channel_message. The previous app version reads every row it read before, writes a message with text as it
-- did, and never touches the new folder or table.

-- The files of one channel message. Rows are written only by their sender's own reserve (reserve_channel_files), which
-- links each to the message its send key already stored; nobody inserts one by hand, and a message is append-only, so a
-- file stays with the message it was sent with.
create table public.channel_attachments (
 id bigint generated always as identity primary key,
 company_id uuid not null,
 channel_id uuid not null,
 send_key uuid not null,
 message_id bigint not null references public.channel_messages(id),
 position smallint not null default 0 check (position between 0 and 20),
 name text not null check (length(name) between 1 and 255),
 content_type text not null check (length(content_type) between 1 and 127),
 size bigint not null check (size between 1 and 20971520),
 path text not null check (split_part(path,'/',1)=company_id::text and split_part(path,'/',2)='channels' and split_part(path,'/',3)=channel_id::text),
 created_at timestamptz not null default now(),
 foreign key (channel_id, company_id) references public.channels(id, company_id),
 unique (company_id, path),
 unique (channel_id, send_key, position)
);
create index channel_attachments_message on public.channel_attachments(message_id);

-- Every Member of the channel reads its messages' files, any Role and a Viewer too; nobody outside it does. The sender's
-- key stays theirs, as it does on the message.
alter table public.channel_attachments enable row level security;
create policy channel_attachments_read on public.channel_attachments for select to authenticated using (public.in_channel(channel_id));
revoke all on public.channel_attachments from public, anon, authenticated, service_role;
grant select (id, company_id, channel_id, message_id, position, name, content_type, size, path, created_at)
 on public.channel_attachments to authenticated;
-- The Run's driver reads a message's files to send its images, as the server, with the service key.
grant select on public.channel_attachments to service_role;

-- The sender keeps the images of one message under its send key: the caller is the person sending, so the database checks
-- they are in the channel and may write in its Company (conversation_can_write refuses a Viewer), and that the message
-- under that key is theirs. The server puts the bytes in the Company's folder for these paths; the table's own check
-- keeps every path inside the channel.
create function public.reserve_channel_files(ch uuid, c uuid, message_key uuid, files jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare k public.channels; sent bigint;
begin
 if ch is null or c is null or message_key is null or files is null or jsonb_typeof(files)<>'array'
  or jsonb_array_length(files) not between 1 and 5 then
  raise exception 'channelFilesInvalid' using errcode='22023'; end if;
 select * into k from public.channels where id=ch and company_id=c;
 if not found or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.conversation_can_write(c) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 select m.id into sent from public.channel_messages m
  where m.channel_id=ch and m.company_id=c and m.send_key=message_key and m.person_id=auth.uid() and m.author='person';
 if sent is null then raise exception 'channelNotFound' using errcode='P0002'; end if;
 insert into public.channel_attachments(company_id,channel_id,send_key,message_id,position,name,content_type,size,path)
  select c,ch,message_key,sent,
   coalesce((file->>'position')::smallint,(ord-1)::smallint),
   file->>'name',file->>'content_type',(file->>'size')::bigint,file->>'path'
  from jsonb_array_elements(files) with ordinality as chosen(file,ord)
  on conflict do nothing;
 return (select count(*)::integer from public.channel_attachments a where a.channel_id=ch and a.company_id=c and a.send_key=message_key);
end;
$$;
revoke all on function public.reserve_channel_files(uuid,uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.reserve_channel_files(uuid,uuid,uuid,jsonb) to authenticated;

-- A send whose bytes could not be written gives its rows back, with the paths the server then removes from the bucket.
-- Only the sender's own message under that key, and only files still linked to it.
create function public.discard_channel_files(ch uuid, c uuid, message_key uuid)
returns setof text language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.channels k where k.id=ch and k.company_id=c) or not public.in_channel(ch) then
  raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.conversation_can_write(c) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 return query delete from public.channel_attachments a
  using public.channel_messages m
  where a.channel_id=ch and a.company_id=c and a.send_key=message_key and m.id=a.message_id and m.person_id=auth.uid()
  returning a.path;
end;
$$;
revoke all on function public.discard_channel_files(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.discard_channel_files(uuid,uuid,uuid) to authenticated;

-- The bytes are as private as the rows: the Company-wide rules on the bucket skip the channels folder, so a Member who
-- learns a path of a channel they are not in reads nothing there. Only a Member of the channel reads its folder.
alter policy creative_read on storage.objects using (bucket_id='creatives'
 and (storage.foldername(name))[2] is distinct from 'conversations' and (storage.foldername(name))[2] is distinct from 'channels'
 and public.is_member(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then (storage.foldername(name))[1]::uuid end));
alter policy creative_write on storage.objects with check (bucket_id='creatives'
 and (storage.foldername(name))[2] is distinct from 'conversations' and (storage.foldername(name))[2] is distinct from 'channels'
 and public.work_can_edit(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then (storage.foldername(name))[1]::uuid end));
create policy channel_file_read on storage.objects for select to authenticated using (bucket_id='creatives'
 and (storage.foldername(name))[2]='channels'
 and exists(select 1 from public.channels k where k.id::text=(storage.foldername(name))[3]
  and k.company_id::text=(storage.foldername(name))[1] and public.in_channel(k.id)));

-- A message may carry images alone (#156), so a stored message's body may be empty. Every message the previous app
-- version writes keeps its text, as the route it sends through still refuses a blank one.
alter table public.channel_messages drop constraint channel_messages_body_check;
alter table public.channel_messages add constraint channel_messages_body_check check (length(body) between 0 and 200000);

-- post_channel_message, as 20261227000000_team_channels.sql left it, with only its blank-text check changed: a message
-- may be images alone, while a text of spaces only is still refused as it was.
do $$
declare def text;
begin
 def:=pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure);
 if position($q$btrim(message)=''$q$ in def)=0 then raise exception 'post_channel_message changed: %',def; end if;
 execute replace(def,$q$btrim(message)=''$q$,$q$(length(message)>0 and btrim(message)='')$q$);
end $$;

-- A claimed start says whether its message carries images, as a Conversation's turn does (#155), so the driver reads
-- them from the channel's files only when it must: every Run without one starts exactly as before. The rest is
-- 20270213000000_one_hermes.sql's begin_channel_start unchanged.
drop function public.begin_channel_start(bigint);
create function public.begin_channel_start(message bigint)
 returns table(attempt integer, company uuid, profile text, session uuid, input text, instructions text, rules text[], has_files boolean)
 language plpgsql security definer set search_path='' as $function$
declare r public.channel_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.channel_runs where message_id=message for update;
 if r.message_id is null or r.outcome is not null or r.run_id is not null then return; end if;
 -- Never started: given up after ten minutes. May have started: given up after a day, as ADR 0015 gives up a start
 -- whose answer was lost.
 if r.attempts = 0 and r.created_at < now()-interval '10 minutes' then perform public.close_channel_run(message,null,'failed',null,null,null); return; end if;
 if r.attempts > 0 and r.created_at < now()-interval '1 day' then perform public.close_channel_run(message,null,'lost',null,null,null); return; end if;
 if r.attempts = 0 then
  select a.connection_id,a.profile into r.connection_id,r.profile from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id;
  if r.profile is null then perform public.close_channel_run(message,null,'failed',null,null,null); return; end if;
 elsif r.profile is null then
  perform public.close_channel_run(message,null,'lost',null,null,null); return;
 end if;
 -- ADR 0014: a Company profile serves its own Company, and no Run starts while its tools are pending. Waiting returns
 -- nothing; the deadlines above end the wait.
 if r.profile ~ '^co-[0-9a-f]{32}$' and (r.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 -- ADR 0016: an Agent profile serves its own Agent, on the same terms.
 if public.agent_profile_refusal(r.profile,r.company_id,r.agent_id) is not null then return; end if;
 update public.channel_runs set attempts=attempts+1, attempted_at=now(), connection_id=r.connection_id, profile=r.profile
  where message_id=message returning attempts into r.attempts;
 return query select r.attempts, r.company_id, r.profile, r.session, r.input, r.instructions, r.rules,
  exists(select 1 from public.channel_attachments a where a.message_id=message);
end $function$;
revoke all on function public.begin_channel_start(bigint) from public,anon,authenticated;
grant execute on function public.begin_channel_start(bigint) to service_role;
