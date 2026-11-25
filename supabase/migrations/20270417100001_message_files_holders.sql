-- #727: a discard never takes the rows a concurrent send of the same key still relies on.
-- Two sends of one key (a double click) can overlap so that send A keeps its rows, send B finds them still there, adds
-- none and writes its images at the paths they name, and then A's upload or send fails and A gives the rows back:
-- discard_conversation_files or discard_channel_files deleted every waiting row of the key and the server removed their
-- paths, B's images with them. B's channel message was then stored with no images, or its turn found no file rows, and
-- its sender saw no error.
--
-- Each waiting row now records the keep attempts that hold it (`holders`) and when one last did (`held_at`). A reserve
-- that names its attempt holds every waiting row of the key, the ones it inserts and the ones it finds. The discard that
-- names its attempt takes only that attempt off them, and deletes, and names for removal, only the rows no attempt holds
-- any more. So A's discard leaves B's rows and objects, and whichever of the two gives them back last takes them. A
-- stored message's rows are its own as before (no discard takes a row a message took), and a Conversation's turn or Run
-- still holds its key's rows as #465 made it: the discard takes its attempt off them and gives nothing back.
--
-- A hold lapses fifteen minutes after the last reserve of the key: an attempt that stored its message or turn never gives
-- its rows back, and one whose server stopped mid-send never can, so their holds must not keep waiting rows from a later
-- discard of the key, which took them before this change. One send's keep, upload and discard are one request, which
-- ends long before.
--
-- Additive (ADR 0023): the previous app version calls the five-argument reserves and the three-argument discards. Its
-- reserves now hold the rows too; its discards keep their meaning and still take every waiting row of the key, holders or
-- not, so nothing of its own sends is left behind. While both versions serve, a discard of the previous version can still
-- take the rows a send of this version holds: the only overlap this does not cover, for the minutes the update takes.
-- This release calls the discard overload that names its attempt.
alter table public.conversation_attachments add column holders uuid[] not null default '{}', add column held_at timestamptz;
alter table public.channel_attachments add column holders uuid[] not null default '{}', add column held_at timestamptz;

do $$
declare def text;
 counted text:=$q$ return (select count(*)::integer from public.conversation_attachments a$q$;
 channel_counted text:=$q$ return (select count(*)::integer from public.channel_attachments a$q$;
 conversation_held text:=$q$ perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
$q$;
 conversation_taken text:=$q$  where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key and a.message_id is null
  returning a.path;$q$;
 channel_taken text:=$q$   and a.message_id is null and a.person_id=auth.uid()
  returning a.path;$q$;
begin
 -- A reserve that names its attempt holds every waiting row of the key: the ones it adds and the ones it finds.
 def:=pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb,uuid)'::regprocedure);
 if position(counted in def)=0 or position('holders' in def)>0 then raise exception 'reserve_conversation_files changed: %',def; end if;
 execute replace(def,counted,$q$ update public.conversation_attachments a
  set holders=case when attempt=any(a.holders) then a.holders else array_append(a.holders,attempt) end,held_at=now()
  where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key and a.message_id is null;
$q$||counted);
 def:=pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb,uuid)'::regprocedure);
 if position(channel_counted in def)=0 or position('holders' in def)>0 then raise exception 'reserve_channel_files changed: %',def; end if;
 execute replace(def,channel_counted,$q$ update public.channel_attachments a
  set holders=case when attempt=any(a.holders) then a.holders else array_append(a.holders,attempt) end,held_at=now()
  where a.channel_id=ch and a.company_id=c and a.send_key=message_key and a.message_id is null and a.person_id=auth.uid();
$q$||channel_counted);

 -- The discard that names its attempt: built from the three-argument one, which stays as it is. It takes its attempt off
 -- the key's waiting rows first, also when a turn or Run holds them, and takes only rows no live hold keeps.
 def:=pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid)'::regprocedure);
 if position(conversation_held in def)=0 or position(conversation_taken in def)=0 or position('holders' in def)>0 then
  raise exception 'discard_conversation_files changed: %',def; end if;
 def:=replace(def,'message_key uuid)','message_key uuid, attempt uuid)');
 def:=replace(def,conversation_held,conversation_held||$q$ if attempt is null then raise exception 'conversationFilesInvalid' using errcode='22023'; end if;
 update public.conversation_attachments a set holders=array_remove(a.holders,attempt)
  where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key and a.message_id is null
   and attempt=any(a.holders);
$q$);
 def:=replace(def,conversation_taken,$q$  where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key and a.message_id is null
   and (cardinality(a.holders)=0 or a.held_at<now()-interval '15 minutes')
  returning a.path;$q$);
 execute def;

 def:=pg_get_functiondef('public.discard_channel_files(uuid,uuid,uuid)'::regprocedure);
 if position(channel_taken in def)=0 or position('holders' in def)>0 then raise exception 'discard_channel_files changed: %',def; end if;
 def:=replace(def,'message_key uuid)','message_key uuid, attempt uuid)');
 def:=replace(def,$q$ return query delete from public.channel_attachments a$q$,$q$ if attempt is null then raise exception 'channelFilesInvalid' using errcode='22023'; end if;
 update public.channel_attachments a set holders=array_remove(a.holders,attempt)
  where a.channel_id=ch and a.company_id=c and a.send_key=message_key and a.message_id is null and a.person_id=auth.uid()
   and attempt=any(a.holders);
 return query delete from public.channel_attachments a$q$);
 def:=replace(def,channel_taken,$q$   and a.message_id is null and a.person_id=auth.uid()
   and (cardinality(a.holders)=0 or a.held_at<now()-interval '15 minutes')
  returning a.path;$q$);
 execute def;
end $$;
revoke all on function public.discard_conversation_files(uuid,uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.discard_conversation_files(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.discard_channel_files(uuid,uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.discard_channel_files(uuid,uuid,uuid,uuid) to authenticated;
