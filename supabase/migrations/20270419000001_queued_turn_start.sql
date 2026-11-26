-- #889: a send that starts its own turn reads where that turn stands when another starter (the worker's pass) claimed it
-- first: started or failed there, its start still in flight or handed back as never reached (due to the send again), or
-- waiting for another reason. The service role the send starts turns with reads neither the queued turns nor their
-- reservations (no grant gives it either table), so it asks here, as it claims and begins a start through the
-- database's own functions. The previous app version never calls it.
create function public.queued_turn_start(conversation uuid, message_key uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
  when q.conversation_id is null then 'waiting'
  when q.started_at is not null then 'started'
  when q.failed_at is not null then case when q.model_refused then 'modelRefused' else 'failed' end
  when r.conversation_id is null or r.abandoned_at is not null or r.start_unknown_at is not null then 'waiting'
  else 'inFlight'
 end
 from (select 1) as one
 left join public.conversation_queued_turns q on q.conversation_id=conversation and q.send_key=message_key
 left join public.conversation_run_reservations r on r.conversation_id=conversation and r.send_key=message_key;
$$;
revoke all on function public.queued_turn_start(uuid,uuid) from public,anon,authenticated;
grant execute on function public.queued_turn_start(uuid,uuid) to service_role;
