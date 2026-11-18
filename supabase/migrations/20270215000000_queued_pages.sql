-- Queued turns page through every waiting Conversation (#68). The previous list stopped at 500 with no order, so 500
-- Conversations whose Company profile was not ready yet (claim_conversation_turn leaves them waiting) could keep a ready
-- one off the worker's page for good. This one orders by Conversation id behind a cursor, so the worker reads every page.
--
-- Additive: the previous app version's `queued_conversations(just)` call still answers, because `after` defaults, and
-- the result is still the one `conversation` column. Only the service role may run it.

drop function public.queued_conversations(uuid);
create function public.queued_conversations(just uuid default null, after uuid default null)
returns table(conversation uuid) language sql stable security definer set search_path='' as $$
 select distinct q.conversation_id from public.conversation_queued_turns q
 where q.started_at is null and q.failed_at is null and (just is null or q.conversation_id=just)
  and (after is null or q.conversation_id>after)
  and not exists(select 1 from public.conversation_open_run(q.conversation_id))
  and not exists(select 1 from public.conversation_run_reservations r where r.conversation_id=q.conversation_id and r.abandoned_at is null
   and not exists(select 1 from public.conversation_queued_turns o where o.conversation_id=r.conversation_id and o.send_key=r.send_key and o.started_at is null and o.failed_at is null))
 order by q.conversation_id
 limit 500;
$$;
revoke all on function public.queued_conversations(uuid,uuid) from public,anon,authenticated;
grant execute on function public.queued_conversations(uuid,uuid) to service_role;
