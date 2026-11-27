-- #846: the old board is switched off. Its approvals and the mentions in its Cards' notes are no rows of anyone's Waiting
-- on you (lib/approval-queue.ts leaves them out, and nothing in the product answers them any more), so they no longer make
-- an Agent wait on the reader either. Only that test changes; the function keeps its signature, its grants and every
-- other part, so the previous app version reads it as before. No table is changed and no row is touched.
create or replace function public.agent_face_states(c uuid) RETURNS TABLE(agent uuid, state text, working boolean, waiting boolean, failed_at timestamp with time zone, failed_conversation uuid, failed_channel uuid, failed_card bigint, last_work_at timestamp with time zone, created_at timestamp with time zone, woken_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    SET plan_cache_mode TO 'force_generic_plan'
    AS $$
#variable_conflict use_column
declare asking uuid[];
begin
 -- The Agents something of which waits on the reader, read once.
 asking := array(
  select x.agent from public.waiting_list(c) w cross join lateral (
   select v.agent_id agent from public.conversations v where v.id=w.conversation_id and v.company_id=c
   union all select k.agent_id from public.work_cards k where k.id=w.card_id and k.company_id=c
   union all select r.agent_id from public.waiting_items i join public.agent_rules r on r.id=i.agent_rule_id
    where w.kind='rule_suggestion' and i.id=w.id and i.kind=w.kind and i.company_id=c
   union all select m.agent_id from public.waiting_items i join public.channel_messages m on m.id=i.channel_message_id
    where w.kind='channel_mention' and i.id=w.id and i.kind=w.kind and i.company_id=c
   union all select r.agent_id from public.channel_permissions p join public.channel_runs r on r.message_id=p.message_id and r.ordinal=p.ordinal
    where w.kind='channel_permission' and p.id=w.id and p.company_id=c
   union all select r.agent_id from public.reply_cards q join public.channel_runs r on r.message_id=q.channel_message_id and r.ordinal=coalesce(q.channel_ordinal,1)
    where w.kind in ('channel_question','channel_hand') and q.id=w.id and q.company_id=c
   union all select k.agent_id from public.agent_key_waits k where w.kind='agent_key' and k.id=w.id and k.company_id=c
   union all select unnest(array[p.agent_id, p.proposed_by]) from public.agent_change_proposals p
    where w.kind='agent_change' and p.id=w.id and p.company_id=c
   union all select r.agent_id from public.agent_access_requests r where w.kind='agent_access' and r.id=w.id and r.company_id=c
  ) x where x.agent is not null and w.kind not in ('approval','mention'));
 return query
 select a.agent,
  case when s.waiting then 'waiting' when a.working then 'working' when a.failed_at is not null then 'stuck'
   when coalesce(a.created_at, '-infinity') < now() - interval '7 days'
    and coalesce(greatest(a.last_work_at, a.woken_at), '-infinity') < now() - interval '7 days' then 'asleep'
   else 'idle' end,
  a.working, s.waiting, a.failed_at, a.failed_conversation, a.failed_channel, a.failed_card, a.last_work_at, a.created_at, a.woken_at
 from public.agent_work(c) a
 cross join lateral (select a.agent = any(asking) waiting) s;
end $$;
