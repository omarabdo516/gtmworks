-- Queued turns page through every waiting Conversation (#68). The previous list stopped at 500 and never skipped a
-- Conversation whose Company profile the worker had not finished, so 500 such Conversations could keep a ready one off
-- the worker's page. This one leaves them out before the limit, exactly while claim_conversation_turn would return
-- without changing anything, and orders by Conversation id behind a cursor so the next page follows on.
--
-- Additive: the previous app version's `queued_conversations(just)` call still answers, because both arguments default,
-- and the result is still the one `conversation` column. Only the service role may run it.

drop function public.queued_conversations(uuid);
create function public.queued_conversations(just uuid default null, after uuid default null)
returns table(conversation uuid) language sql stable security definer set search_path='' as $$
 with waiting as (
  -- The turn claim_conversation_turn would take: its own active reservation first, then the oldest.
  select distinct on (q.conversation_id) q.conversation_id,q.company_id,q.agent_id,q.send_key
  from public.conversation_queued_turns q
  where q.started_at is null and q.failed_at is null
   and (just is null or q.conversation_id=just)
   and (after is null or q.conversation_id>after)
   and not exists(select 1 from public.conversation_open_run(q.conversation_id))
   and not exists(select 1 from public.conversation_run_reservations r
    where r.conversation_id=q.conversation_id and r.abandoned_at is null
     and not exists(select 1 from public.conversation_queued_turns o
      where o.conversation_id=r.conversation_id and o.send_key=r.send_key and o.started_at is null and o.failed_at is null))
  order by q.conversation_id,
   exists(select 1 from public.conversation_run_reservations r
    where r.conversation_id=q.conversation_id and r.send_key=q.send_key and r.abandoned_at is null) desc,
   q.queued_at,q.send_key
 ), next_turn as (
  -- Its profile, as the claim reads it: the reservation's own or the Agent's of now, and whether its start may have
  -- happened (never failed for a profile that is not ready).
  select w.conversation_id,w.company_id,w.agent_id,
   coalesce(r.profile,a.profile) as profile,
   r.conversation_id is not null and (r.start_unknown_at is not null or r.start_attempts>0) as uncertain
  from waiting w
  left join public.conversation_run_reservations r
   on r.conversation_id=w.conversation_id and r.send_key=w.send_key and r.abandoned_at is null
  left join public.hermes_agents a
   on r.conversation_id is null and a.id=w.agent_id and a.company_id=w.company_id
 )
 select n.conversation_id from next_turn n
 where n.profile is null
  or n.uncertain
  -- The turn would be failed by the claim, not left waiting: it is listed so the claim can fail it.
  or (n.profile ~ '^co-[0-9a-f]{32}$' and n.profile<>public.company_engine_profile(n.company_id))
  or public.agent_profile_refusal(n.profile,n.company_id,n.agent_id)='hermesProfileNotShared'
  -- The claim would return without changing anything until the profile is ready: leave it out before the limit.
  or not ((n.profile ~ '^co-[0-9a-f]{32}$' and not public.company_profile_ready(n.company_id))
   or public.agent_profile_refusal(n.profile,n.company_id,n.agent_id)='agentLevelPending')
 order by n.conversation_id
 limit 500;
$$;
revoke all on function public.queued_conversations(uuid,uuid) from public,anon,authenticated;
grant execute on function public.queued_conversations(uuid,uuid) to service_role;
