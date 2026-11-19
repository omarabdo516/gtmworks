-- #355 review: a file's path is the database's to build. The caller names its send key and each image's place, never a
-- path: reserve_conversation_files and reserve_channel_files name every row themselves, so a path can never point
-- outside the Conversation or channel it belongs to, and only the image kinds the Engine reads are kept.
--
-- Additive: the previous app version still reads every row it read before, and a channel's files may now be kept before
-- the message that carries them is stored (message_id is null until it is). No data is dropped or rewritten.

-- A channel's file belongs to a send before it belongs to a message: the message links it when it is stored (the
-- trigger below), so the rows may be written first. `person_id` keeps track of whose send it is, for discard.
alter table public.channel_attachments alter column message_id drop not null;
alter table public.channel_attachments add column person_id uuid default auth.uid();

-- The message a channel send key becomes takes the files sent with it, whenever it is stored: the same link a
-- Conversation's message makes (#155). A message is append-only, so this runs once per message.
create function public.link_channel_files() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.author='person' and new.send_key is not null then
  update public.channel_attachments set message_id=new.id
   where channel_attachments.channel_id=new.channel_id and channel_attachments.company_id=new.company_id
    and channel_attachments.send_key=new.send_key and channel_attachments.message_id is null;
 end if;
 return null;
end;
$$;
revoke all on function public.link_channel_files() from public,anon,authenticated,service_role;
create trigger channel_messages_link_files after insert on public.channel_messages for each row execute function public.link_channel_files();

-- The sender's files for one Conversation message: the rows first, named by the database under the Conversation and the
-- send key. The caller's own `path` is ignored; only the image kinds the Engine reads are accepted. A send key whose
-- files are already linked to a stored message is refused, so a stored message's images can never be replaced.
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

-- The sender's files for one channel message: kept before the message is stored, under the send key and the caller's own
-- person, with the database naming every path. The caller must be in the channel and may write in it; an image the
-- Engine cannot read is refused, and a send key already linked to a stored message is refused too.
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
   where a.channel_id=ch and a.company_id=c and a.send_key=message_key and a.message_id is not null) then
  raise exception 'channelNotFound' using errcode='P0002'; end if;
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

-- A send that stored no message gives its own rows back, with the paths the server then removes from the bucket. Only
-- files still waiting for a message, and only the caller's own send.
create or replace function public.discard_channel_files(ch uuid, c uuid, message_key uuid)
returns setof text language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.channels k where k.id=ch and k.company_id=c) or not public.in_channel(ch) then
  raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.conversation_can_write(c) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 return query delete from public.channel_attachments a
  where a.channel_id=ch and a.company_id=c and a.send_key=message_key
   and a.message_id is null and a.person_id=auth.uid()
  returning a.path;
end;
$$;

-- A message may be images alone only when its send key already keeps some: empty text with nothing to carry it is
-- refused, and so is text of spaces only, as before. post_channel_message, as 20270221000000_channel_message_files.sql
-- left it, with only that rule changed.
do $$
declare def text;
begin
 def:=pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure);
 if position($q$(length(message)>0 and btrim(message)='')$q$ in def)=0 then raise exception 'post_channel_message changed: %',def; end if;
 execute replace(def,$q$(length(message)>0 and btrim(message)='')$q$,$q$(btrim(message)='' and not exists(select 1 from public.channel_attachments a where a.channel_id=ch and a.send_key=message_key and a.message_id is null and a.person_id=auth.uid()))$q$);
end $$;

-- A channel's stored image is read by the Members of that channel. Inside the subquery a bare `name` is the channel's own
-- name, not the object's path, so the policy names the object's column outright.
alter policy channel_file_read on storage.objects using (bucket_id='creatives'
 and (storage.foldername(objects.name))[2]='channels'
 and exists(select 1 from public.channels k where k.id::text=(storage.foldername(objects.name))[3]
  and k.company_id::text=(storage.foldername(objects.name))[1] and public.in_channel(k.id)));
