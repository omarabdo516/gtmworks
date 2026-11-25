-- #767 (spec #759): a Conversation's poll asks only whether anything changed since its last read. The stamp changes
-- whenever a row the Conversation's record reads changes: each table's row count and the sum of its rows' transaction
-- ids (xmin, which every insert and update writes anew), for this Conversation, and its own row. The browser sends the
-- stamp it last read, and the route reads the record only when the stamp differs. One round trip; nothing is stored.
-- Only the Conversation's own person, while a Member, reads it; anyone else reads null, as a missing Conversation.
--
-- Additive (ADR 0023): one new function.
create function public.conversation_stamp(conversation uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(concat_ws('|',
  (select xmin::text from public.conversations where id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.conversation_messages where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.conversation_queued_turns where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.conversation_run_ends where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.conversation_run_resets where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.conversation_run_reservations where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.conversation_notes where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.conversation_attachments where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.reply_cards where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.agent_rules where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.agent_handovers where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.agent_change_proposals where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.lead_agent_requests where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.lead_made_agents where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.agent_access_requests where conversation_id=conversation),
  (select count(*)::text||':'||coalesce(sum(xmin::text::bigint),0)::text from public.work_cards where conversation_id=conversation)))
 where exists(select 1 from public.conversations v where v.id=conversation and v.person_id=auth.uid() and public.is_member(v.company_id));
$$;
revoke all on function public.conversation_stamp(uuid) from public,anon,service_role;
grant execute on function public.conversation_stamp(uuid) to authenticated;
