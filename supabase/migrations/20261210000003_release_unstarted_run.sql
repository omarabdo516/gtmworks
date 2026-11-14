-- A reservation whose run never started (ADR 0014). When the pinned Connection cannot be used or the engine refuses
-- the start, no run exists to hold the move or the Connection's removal for, so the sender's own request abandons its
-- reservation at once instead of leaving it active until the worker's ten minutes pass. The row is kept, as every
-- abandoned reservation is, and a retry with the same send key reserves again through every check.
--
-- Only the sender's own active reservation in that company is abandoned, under the lock the move, the record and the
-- worker's abandon take, so a record in flight for the same send key either lands first or is refused as late
-- (conversationSendAgain). Nothing existing is rewritten; the previous app version never calls this.

create function public.release_conversation_run(conversation uuid, c uuid, message_key uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare released integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 update public.conversation_run_reservations r set abandoned_at=now()
  where r.conversation_id=conversation and r.send_key=message_key and r.company_id=c and r.person_id=auth.uid() and r.abandoned_at is null;
 get diagnostics released=row_count;
 return released>0;
end $$;
revoke all on function public.release_conversation_run(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.release_conversation_run(uuid,uuid,uuid) to authenticated;
