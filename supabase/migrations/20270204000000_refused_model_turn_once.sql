-- #158, review of #330: a waiting turn the Engine refused for its model is settled in one call with the attempt it
-- refused (refuse_run_model with three arguments). Under the lock begin_start takes, and only while that attempt is
-- still the reservation's latest, the Conversation goes back to its earlier model, the turn is marked refused for it and
-- failed, and its reservation released, all in one transaction. A stale refusal changes nothing, so a newer attempt
-- keeps its pinned model and a refused turn is never started again on another model.
--
-- Only a function is added: the previous app version calls the two-argument refuse_run_model and then
-- fail_conversation_turn, both unchanged.
create function public.refuse_run_model(conversation uuid, message_key uuid, attempt integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare refused boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 -- A reservation already settled (the turn recorded or failed) is as stale as one a newer attempt began.
 if not exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null
  and r.start_unknown_at is null and r.start_attempts=attempt) then return false; end if;
 refused:=public.refuse_run_model(conversation,message_key);
 perform public.fail_conversation_turn(conversation,message_key,attempt);
 return refused;
end $$;
revoke all on function public.refuse_run_model(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.refuse_run_model(uuid,uuid,integer) to service_role;
