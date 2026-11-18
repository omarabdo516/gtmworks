-- #355 review: an image-only retry of a send whose message is already stored is that same send. The empty body is
-- accepted when the send key's images are already linked to this sender's own stored message, so the post reaches the
-- send key's own deduplication (the insert conflicts, and the key's message answers) instead of failing before it.
--
-- Additive: only the empty-body rule of post_channel_message changes. Every message the previous app version posts keeps
-- its text, an empty body with nothing of the sender's under its key is still refused, and no row is dropped or
-- rewritten.

do $$
declare def text;
begin
 def:=pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure);
 if position($q$(btrim(message)='' and not exists(select 1 from public.channel_attachments a where a.channel_id=ch and a.send_key=message_key and a.message_id is null and a.person_id=auth.uid()))$q$ in def)=0 then
  raise exception 'post_channel_message changed: %',def; end if;
 execute replace(def,
  $q$(btrim(message)='' and not exists(select 1 from public.channel_attachments a where a.channel_id=ch and a.send_key=message_key and a.message_id is null and a.person_id=auth.uid()))$q$,
  $q$(btrim(message)='' and not exists(select 1 from public.channel_attachments a left join public.channel_messages m on m.id=a.message_id where a.channel_id=ch and a.send_key=message_key and a.person_id=auth.uid() and (a.message_id is null or (m.channel_id=ch and m.send_key=message_key and m.person_id=auth.uid() and m.author='person'))))$q$);
end $$;

-- #355 review: two writers must not both pass the sender check of one send key and reserve different places under it.
-- Each reserve takes a transaction-scoped advisory lock on the place and the send key, so its check and its insert are
-- one step for every caller: the same bodies as 20270219000000_message_files_retries.sql, with the lock added. A null
-- key hashes to no lock and is refused by the checks below, as before.

create or replace function public.reserve_conversation_files(conversation uuid, c uuid, message_key uuid, files jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare existing public.conversations;
begin
 perform pg_advisory_xact_lock(hashtextextended('conversation_files:'||conversation::text||':'||message_key::text,0));
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

create or replace function public.reserve_channel_files(ch uuid, c uuid, message_key uuid, files jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare k public.channels;
begin
 perform pg_advisory_xact_lock(hashtextextended('channel_files:'||ch::text||':'||message_key::text,0));
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

