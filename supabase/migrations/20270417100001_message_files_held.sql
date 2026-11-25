-- #727: a discard never takes the rows a concurrent send of the same key still relies on.
-- Two sends of one key (a double click) can overlap so that send A keeps its rows, send B finds them still there, adds
-- none and writes its images at the paths they name, and then A's upload or send fails and A gives the rows back:
-- discard_conversation_files or discard_channel_files deleted every waiting row of the key and the server removed their
-- paths, B's images with them. B's channel message was then stored with no images, or its turn found no file rows, and
-- its sender saw no error.
--
-- Each waiting row now records the keep attempts that still hold it (`attempts`). A reserve that names its attempt adds
-- it to every waiting row of the key, the ones it inserts and the ones it finds; a discard that names its attempt takes
-- only that attempt off them, and deletes, and names for removal, only the rows no attempt holds any more. So A's
-- discard leaves B's rows and objects, and whichever of the two gives them back last takes them. A stored message's rows
-- are its own as before (a discard never takes a row a message took), and a Conversation's turn or Run still holds its
-- key's rows as #465 made it: the discard takes its attempt off them and gives nothing back.
--
-- Additive (ADR 0023): the four-argument reserves and three-argument discards keep their signatures and grants for the
-- previous app version. Its reserve adds no holder, so a row it keeps is taken by any discard as before; its discard names
-- no attempt, so it takes only rows no attempt holds. This release calls the discard overload that names its attempt.
-- A send whose server stopped between its keep and its send or discard leaves its attempt on the rows; they stay, as
-- they would have before until a later discard of that key, and no reader treats them as a message's.
alter table public.conversation_attachments add column attempts uuid[] not null default '{}';
alter table public.channel_attachments add column attempts uuid[] not null default '{}';

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
 if position(counted in def)=0 or position('attempts' in def)>0 then raise exception 'reserve_conversation_files changed: %',def; end if;
 execute replace(def,counted,$q$ update public.conversation_attachments a set attempts=array_append(a.attempts,attempt)
  where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key and a.message_id is null
   and not attempt=any(a.attempts);
$q$||counted);
 def:=pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb,uuid)'::regprocedure);
 if position(channel_counted in def)=0 or position('attempts' in def)>0 then raise exception 'reserve_channel_files changed: %',def; end if;
 execute replace(def,channel_counted,$q$ update public.channel_attachments a set attempts=array_append(a.attempts,attempt)
  where a.channel_id=ch and a.company_id=c and a.send_key=message_key and a.message_id is null and a.person_id=auth.uid()
   and not attempt=any(a.attempts);
$q$||channel_counted);

 -- Every discard takes only the rows no attempt holds.
 def:=pg_get_functiondef('public.discard_conversation_files(uuid,uuid,uuid)'::regprocedure);
 if position(conversation_held in def)=0 or position(conversation_taken in def)=0 or position('attempts' in def)>0 then
  raise exception 'discard_conversation_files changed: %',def; end if;
 def:=replace(def,conversation_taken,$q$  where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key and a.message_id is null
   and cardinality(a.attempts)=0
  returning a.path;$q$);
 execute def;
 -- The overload that names its attempt takes it off the key's waiting rows first, also when a turn or Run holds them.
 def:=replace(def,'message_key uuid)','message_key uuid, attempt uuid)');
 def:=replace(def,conversation_held,conversation_held||$q$ if attempt is null then raise exception 'conversationFilesInvalid' using errcode='22023'; end if;
 update public.conversation_attachments a set attempts=array_remove(a.attempts,attempt)
  where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key and a.message_id is null
   and attempt=any(a.attempts);
$q$);
 execute def;

 def:=pg_get_functiondef('public.discard_channel_files(uuid,uuid,uuid)'::regprocedure);
 if position(channel_taken in def)=0 or position('attempts' in def)>0 then raise exception 'discard_channel_files changed: %',def; end if;
 def:=replace(def,channel_taken,$q$   and a.message_id is null and a.person_id=auth.uid() and cardinality(a.attempts)=0
  returning a.path;$q$);
 execute def;
 def:=replace(def,'message_key uuid)','message_key uuid, attempt uuid)');
 def:=replace(def,$q$ return query delete from public.channel_attachments a$q$,$q$ if attempt is null then raise exception 'channelFilesInvalid' using errcode='22023'; end if;
 update public.channel_attachments a set attempts=array_remove(a.attempts,attempt)
  where a.channel_id=ch and a.company_id=c and a.send_key=message_key and a.message_id is null and a.person_id=auth.uid()
   and attempt=any(a.attempts);
 return query delete from public.channel_attachments a$q$);
 execute def;
end $$;
revoke all on function public.discard_conversation_files(uuid,uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.discard_conversation_files(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.discard_channel_files(uuid,uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.discard_channel_files(uuid,uuid,uuid,uuid) to authenticated;
