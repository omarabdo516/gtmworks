-- #708, ADR 0028: an Agent hands its person a file in its reply. The Agent names a file it made in its own work folder by
-- a `MEDIA:` line; the worker reads it there (lib/reply-files.mjs), keeps its bytes in the place's private folder of the
-- `creatives` bucket, and the Run's close stores the reply with its files, as rows of the files table the person's own
-- messages use, linked to the Agent's message. A file that could not be attached is kept by its name alone, on the
-- message, so the reply says so instead of showing a path.
--
-- Additive (ADR 0023): two columns, a looser size check, and one overload beside each close the previous app version
-- calls, which keeps its arguments, its body and its meaning. The previous version never reads the new columns, and a
-- file row on an Agent's message is one more row it reads as it reads a person's.

-- A file an Agent hands over is served up to the Library's own limit (lib/hermes.mjs, 25 MB); a person's own send keeps
-- its 20 MB, which its routes and reserves check before a row is written.
alter table public.conversation_attachments drop constraint conversation_attachments_size_check,
 add constraint conversation_attachments_size_check check (size between 1 and 26214400);
alter table public.channel_attachments drop constraint channel_attachments_size_check,
 add constraint channel_attachments_size_check check (size between 1 and 26214400);

-- The names of the files a reply named but could not hand over (another Agent's folder, a file not there, one past the
-- limit). Null for every message that named none.
alter table public.conversation_messages add column missed_files text[]
 check (missed_files is null or cardinality(missed_files) between 1 and 20);
alter table public.channel_messages add column missed_files text[]
 check (missed_files is null or cardinality(missed_files) between 1 and 20);
grant select (missed_files) on public.channel_messages to authenticated;

-- What a close is handed: at most ten files, each with its place, name, type and size, and at most twenty missed names.
-- The path of each is built here, never taken from the caller: <company>/<folder>/<place>/reply-<md5 of the Run>-<place>,
-- the one lib/reply-files.mjs wrote the bytes to.
create function public.reply_files_valid(files jsonb, missed text[]) returns boolean language sql immutable set search_path='' as $$
 select (files is null or jsonb_typeof(files)='array' and jsonb_array_length(files)<=10 and not exists(
   select 1 from jsonb_array_elements(files) f where jsonb_typeof(f)<>'object' or coalesce(f->>'position','')!~'^[0-9]$'
    or length(coalesce(f->>'name',''))not between 1 and 255 or length(coalesce(f->>'content_type',''))not between 1 and 127
    or coalesce(f->>'size','')!~'^[0-9]{1,9}$'))
  and (missed is null or cardinality(missed)<=20 and not exists(select 1 from unnest(missed) m where length(coalesce(m,'')) not between 1 and 255));
$$;
revoke all on function public.reply_files_valid(jsonb,text[]) from public,anon,authenticated,service_role;
-- Whether a close hands anything over: a reply of files alone has no text, and is still a whole reply.
create function public.reply_hands_files(files jsonb, missed text[]) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_array_length(case when jsonb_typeof(files)='array' then files end),0)>0 or coalesce(cardinality(missed),0)>0;
$$;
revoke all on function public.reply_hands_files(jsonb,text[]) from public,anon,authenticated,service_role;

-- 20270415999994's close_conversation_run, with the reply's files: a completed Run's reply may be files alone, and the
-- Agent's message it stores takes them. A close that stores no message (the Run was closed already) stores no file.
create function public.close_conversation_run(conversation uuid, run text, run_outcome text, reply text, hermes_session text, used_input bigint, used_output bigint, read_completed boolean, reply_files jsonb, missed_files text[])
returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.conversations; closed text; carded boolean := false; said bigint; handed boolean := public.reply_hands_files(reply_files,missed_files);
begin
 if run_outcome is null or run_outcome not in ('completed','stopped','lost','failed','no_model','no_credit','key_refused','model_missing','no_access')
  or run_outcome='completed' and coalesce(btrim(reply),'')='' and not handed or not public.reply_files_valid(reply_files,missed_files)
  or run_outcome<>'completed' and handed then raise exception 'conversationFailed' using errcode='22023'; end if;
 select * into existing from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages where conversation_id=conversation and author='person' and run_id=run) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if run_outcome='failed' and read_completed then
  carded := exists(select 1 from public.reply_cards where conversation_id=conversation and run_id=run and kind in ('draft','review','hand'))
   or exists(select 1 from public.lead_made_agents where conversation_id=conversation and run_id=run)
   or exists(select 1 from public.lead_agent_requests where conversation_id=conversation and run_id=run)
   or exists(select 1 from public.agent_rules where conversation_id=conversation and run_id=run);
 end if;
 insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
  values(existing.company_id,conversation,run,case when carded then 'completed' else run_outcome end)
  on conflict do nothing returning run_id into closed;
 if closed is null then return false; end if;
 if run_outcome='completed' then
  insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id,missed_files)
   values(existing.company_id,conversation,'agent',existing.agent_id,existing.agent_name,left(coalesce(reply,''),200000),run,
    (select array_agg(left(m,255)) from unnest(missed_files) m))
   on conflict do nothing returning id into said;
  if said is not null then
   insert into public.conversation_attachments(company_id,conversation_id,message_id,position,name,content_type,size,path)
    select existing.company_id,conversation,said,(f->>'position')::smallint,f->>'name',f->>'content_type',(f->>'size')::bigint,
     existing.company_id::text||'/conversations/'||conversation::text||'/reply-'||md5(run)||'-'||(f->>'position')
    from jsonb_array_elements(coalesce(reply_files,'[]'::jsonb)) f
    on conflict (company_id,path) do nothing;
  end if;
 end if;
 if run_outcome in ('completed','stopped') or carded then
  update public.conversations set hermes_session_id=hermes_session where id=conversation and hermes_session_id is null and hermes_session is not null;
 end if;
 return true;
end;
$$;
revoke all on function public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean,jsonb,text[]) to service_role;

-- close_channel_run as 20270415650000 wrote it and 20270415997200 and 20270415999950 left it (every model cause a
-- retry cannot fix), with the reply's files, as a Conversation's close takes them. Every Member of the
-- channel reads them, as they read its messages' own files. A file row's send key is the Run's own (md5 of the Run as a
-- uuid), so a reply's files keep one place each.
create function public.close_channel_run(message bigint, run text, run_outcome text, reply text, used_input bigint, used_output bigint, reply_files jsonb, missed_files text[])
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.channel_runs; said bigint; handed boolean := public.reply_hands_files(reply_files,missed_files);
begin
 if run_outcome is null or run_outcome not in ('completed','failed','no_model','no_credit','key_refused','model_missing','no_access','stopped','lost')
  or (run_outcome='completed') <> (coalesce(btrim(reply),'') <> '' or handed) or not public.reply_files_valid(reply_files,missed_files)
  or handed and run is null then
  raise exception 'channelFailed' using errcode='22023'; end if;
 if run is null then
  select * into r from public.channel_runs where message_id=message and outcome is null order by ordinal limit 1 for no key update;
 else
  select * into r from public.channel_runs where message_id=message and outcome is null and run_id=run for no key update;
 end if;
 if r.message_id is null then return false; end if;
 update public.channel_runs set outcome=run_outcome, closed_at=now()
  where message_id=message and ordinal=r.ordinal;
 if run_outcome='completed' then
  insert into public.channel_messages(company_id, channel_id, author, agent_id, author_name, body, reply_to, reply_ordinal, missed_files)
   values (r.company_id, r.channel_id, 'agent', r.agent_id, r.agent_name, left(coalesce(reply,''), 200000), message, r.ordinal,
    (select array_agg(left(m,255)) from unnest(missed_files) m))
   on conflict (reply_to, reply_ordinal) do nothing returning id into said;
  if said is not null then
   insert into public.channel_attachments(company_id,channel_id,send_key,message_id,position,name,content_type,size,path)
    select r.company_id,r.channel_id,md5(run)::uuid,said,(f->>'position')::smallint,f->>'name',f->>'content_type',(f->>'size')::bigint,
     r.company_id::text||'/channels/'||r.channel_id::text||'/reply-'||md5(run)||'-'||(f->>'position')
    from jsonb_array_elements(coalesce(reply_files,'[]'::jsonb)) f
    on conflict do nothing;
  end if;
 end if;
 return true;
end $$;
revoke all on function public.close_channel_run(bigint,text,text,text,bigint,bigint,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.close_channel_run(bigint,text,text,text,bigint,bigint,jsonb,text[]) to service_role;
