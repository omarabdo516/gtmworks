-- #465: a send's images stay while its turn or its Run may still need them.
-- A Conversation's images are kept under the send key before the Agent is asked (#155) and linked to the message once it
-- is stored. Until then the send route gives them back when a send of that key is refused, errors or stores no message
-- (discard_conversation_files, then the server removes the paths it returns). A resend of a key that is already a queued
-- turn, or whose Run start was attempted or marked unknown, took that path too, so gtmworks removed the images of a live
-- request: the turn then read a missing image, and one whose start may already hold a Run can neither fail nor start
-- (fail_conversation_turn rightly refuses), so it held up its Conversation for the worker's one day.
--
-- The rule is kept here, in the one function every caller goes through: nothing is given back while the send key is a
-- queued turn that has neither started nor failed, or holds a Run reservation that is not abandoned (attempted, marked
-- unknown, a retry of either, or reserved and not yet started). Once the turn settles in an ordinary way (its message is
-- stored and takes the files, it fails, or its reservation is abandoned or released), cleanup gives them back as before.
-- An image missing for outside reasons is unchanged: the worker's fail-safe (#368) still handles it.
--
-- Nor are they replaced: a resend of a held key keeps its files again before the Agent is asked, and the server wrote
-- the bytes over the same paths (upsert), so the turn's retry could carry other images under the same idempotency key.
-- reserve_conversation_files now answers such a key -2 (held): no row is added and the server writes nothing at all,
-- neither over a kept object nor beside it at a place no row names (lib/message-files.ts). Its rows imply their bytes
-- were written: a first send whose upload failed gave its rows back before its key was held. -1 keeps its meaning (a
-- stored message's key, whose missing object the server may put back).
--
-- Same signatures and grants: the previous app version calls both as it did; it only gets fewer paths back from the
-- discard, and reads -2 as it reads -1 (any negative): it writes no byte over a kept object (no upsert), at worst an
-- object beside them that no row names, only until this version serves.
create or replace function public.discard_conversation_files(conversation uuid, c uuid, message_key uuid)
returns setof text language plpgsql security definer set search_path='' as $$
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if not exists(select 1 from public.conversations v where v.id=conversation and v.company_id=c and v.person_id=auth.uid()) then
  raise exception 'conversationNotFound' using errcode='P0002'; end if;
 -- Under the Conversation's turn lock (a turn is queued and claimed under it) and then the agents lock (a turn is
 -- recorded or failed, and a reservation begun, released, kept unknown or abandoned, under it), in the order every
 -- other function takes them, so neither changes while this decides.
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if exists(select 1 from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=message_key
   and q.started_at is null and q.failed_at is null)
  or exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key
   and r.abandoned_at is null) then
  return;
 end if;
 return query delete from public.conversation_attachments a
  where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key and a.message_id is null
  returning a.path;
end;
$$;
revoke all on function public.discard_conversation_files(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.discard_conversation_files(uuid,uuid,uuid) to authenticated;

-- The worker starts a waiting turn with its images read from these rows (lib/conversation-runs.mjs pinnedImages), as
-- the service role. It was never granted the read (#155 granted it for channels only), so a waiting turn with images
-- failed every pass on "permission denied" before its start and never started. The read only: the rows are still
-- written and given back by their sender's own functions above.
grant select on public.conversation_attachments to service_role;

-- A send key whose files are already kept and still held by its waiting turn or Run is answered -2: nothing is
-- inserted, and the server writes nothing for it. reserve_conversation_files as
-- 20270224000000_message_files_retry_sends.sql left it, with that one answer added after the stored message's.
do $$
declare def text; stored text:=$q$  return -1; end if;
$q$;
begin
 def:=pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb)'::regprocedure);
 if position(stored in def)=0 or position('conversation_queued_turns' in def)>0 then raise exception 'reserve_conversation_files changed: %',def; end if;
 execute replace(def,stored,stored||$q$ if exists(select 1 from public.conversation_attachments a where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key)
  and (exists(select 1 from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=message_key
    and q.started_at is null and q.failed_at is null)
   or exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key
    and r.abandoned_at is null)) then
  return -2; end if;
$q$);
end $$;
