-- #158, review of #330: a Run sent straight away that the Engine refused for its model is settled by its sender in one
-- call naming the attempt it refused (refuse_conversation_run_model). Under the lock begin_start takes, the sender's
-- reservation is released exactly as release_conversation_run with an attempt releases it, and only when that release
-- happened does the Conversation go back to its earlier model, in the same transaction. A late refusal of an attempt a
-- newer one followed, or of a settled reservation, changes nothing, so the newer attempt keeps its pinned model.
--
-- Only a function is added: the previous app version calls release_conversation_run and the two-argument
-- refuse_run_model, both unchanged.
create function public.refuse_conversation_run_model(conversation uuid, c uuid, message_key uuid, attempt integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare released integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 update public.conversation_run_reservations r set abandoned_at=now()
  where r.conversation_id=conversation and r.send_key=message_key and r.company_id=c and r.person_id=auth.uid() and r.abandoned_at is null
   and r.start_unknown_at is null and r.start_attempts=attempt;
 get diagnostics released=row_count;
 if released=0 then return false; end if;
 return public.refuse_run_model(conversation,message_key);
end $$;
revoke all on function public.refuse_conversation_run_model(uuid,uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.refuse_conversation_run_model(uuid,uuid,uuid,integer) to authenticated;
