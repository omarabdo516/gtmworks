-- #355 review: a send whose answer was lost still finishes. A retry of a send key whose files are already a stored
-- message's own is that same send: the reserve answers -1 (nothing to write again) and the send goes on to its message,
-- which the send key answers with the one it stored. A waiting channel send belongs to one person: another writer's
-- rows under its key are refused, and a channel message links only its own sender's files.
--
-- Additive: the functions keep their signatures, the previous app version reads every row it read before, and no data is
-- dropped or rewritten. A previous app version that ignores -1 uploads the same paths again (upsert), which is harmless.

-- The sender's files for one Conversation message. A retry of a send key whose files a stored message of the same sender
-- already took is answered -1, so its caller uploads nothing and lets the message deduplicate the send. Any other stored
-- message under the key is refused, as before.
create or replace function public.reserve_conversation_files(conversation uuid, c uuid, message_key uuid, files jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare existing public.conversations;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if conversation is null or message_key is null or files is null or jsonb_typeof(files)<>'array'
  or jsonb_array_length(files) not between 1 and 5 then
  raise exception 'conversationFilesInvalid' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(files) as chosen(file)
   where coalesce(file->>'content_type','') not in ('image/png','image/jpeg','image/gif','image/webp')) then
  raise exception 'conversationFilesInvalid' using errcode='22023'; end if;
 select * into existing from public.conversations where id=conversation;
 if not found or existing.person_id<>auth.uid() or existing.company_id<>c then
  raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if exists(select 1 from public.conversation_attachments a
   join public.conversation_messages m on m.id=a.message_id
   where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key
    and m.author='person' and m.person_id=auth.uid()) then
  return -1; end if;
 if exists(select 1 from public.conversation_attachments a
   where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key and a.message_id is not null) then
  raise exception 'conversationNotFound' using errcode='P0002'; end if;
 insert into public.conversation_attachments(company_id,conversation_id,send_key,position,message_id,name,content_type,size,path)
  select c,conversation,message_key,place,
   (select m.id from public.conversation_messages m where m.conversation_id=conversation and m.send_key=message_key and m.author='person' order by m.id limit 1),
   file->>'name',file->>'content_type',(file->>'size')::bigint,
   c::text||'/conversations/'||conversation::text||'/'||message_key::text||'-'||place::text
  from jsonb_array_elements(files) with ordinality as chosen(file,ord)
  cross join lateral (select coalesce(nullif(file->>'position','')::smallint,(ord-1)::smallint) as place) p
  on conflict (company_id,path) do nothing;
 return (select count(*)::integer from public.conversation_attachments a
  where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key);
end;
$$;

-- The sender's files for one channel message. A waiting key belongs to one sender: rows under it written by another
-- person are refused, so nobody adds a file to someone else's waiting send. A retry of a send key whose files a stored
-- message already took is answered -1, so the post goes on and its message deduplicates the send.
create or replace function public.reserve_channel_files(ch uuid, c uuid, message_key uuid, files jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare k public.channels;
begin
 if ch is null or c is null or message_key is null or files is null or jsonb_typeof(files)<>'array'
  or jsonb_array_length(files) not between 1 and 5 then
  raise exception 'channelFilesInvalid' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(files) as chosen(file)
   where coalesce(file->>'content_type','') not in ('image/png','image/jpeg','image/gif','image/webp')) then
  raise exception 'channelFilesInvalid' using errcode='22023'; end if;
 select * into k from public.channels where id=ch and company_id=c;
 if not found or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.conversation_can_write(c) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if exists(select 1 from public.channel_attachments a
   where a.channel_id=ch and a.company_id=c and a.send_key=message_key and a.person_id<>auth.uid()) then
  raise exception 'channelNotFound' using errcode='P0002'; end if;
 if exists(select 1 from public.channel_attachments a
   where a.channel_id=ch and a.company_id=c and a.send_key=message_key and a.message_id is not null) then
  return -1; end if;
 insert into public.channel_attachments(company_id,channel_id,send_key,message_id,person_id,position,name,content_type,size,path)
  select c,ch,message_key,null,auth.uid(),place,
   file->>'name',file->>'content_type',(file->>'size')::bigint,
   c::text||'/channels/'||ch::text||'/'||message_key::text||'-'||place::text
  from jsonb_array_elements(files) with ordinality as chosen(file,ord)
  cross join lateral (select coalesce(nullif(file->>'position','')::smallint,(ord-1)::smallint) as place) p
  on conflict do nothing;
 return (select count(*)::integer from public.channel_attachments a
  where a.channel_id=ch and a.company_id=c and a.send_key=message_key);
end;
$$;

-- A channel message links only its own sender's waiting files, so a key another person happened to name is never taken
-- by this message.
create or replace function public.link_channel_files() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.author='person' and new.send_key is not null then
  update public.channel_attachments set message_id=new.id
   where channel_attachments.channel_id=new.channel_id and channel_attachments.company_id=new.company_id
    and channel_attachments.send_key=new.send_key and channel_attachments.message_id is null
    and channel_attachments.person_id=new.person_id;
 end if;
 return null;
end;
$$;
