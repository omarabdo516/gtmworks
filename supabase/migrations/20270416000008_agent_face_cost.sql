-- #754: the one state read of #699 (20270416000002) cost about 85 ms for three Agents and ran on every render, prefetch
-- and 5-second poll. Most of it was planning, not reading: agent_work ran agent_run_facts once per Agent, each a query of
-- some twenty parts planned again on every call, and asked can_see_agent, in_channel and can_see_card once per row.
-- The same answers, read once for all the reader's Agents: every source of work is read once for the Company, grouped by
-- Agent; which Agents, channels and Cards the reader sees is asked once per Agent, channel or Card, never per Run; and
-- each read is a PL/pgSQL function, whose plans the database keeps between calls on the same connection.
-- What each state means is unchanged (20270416000002). agent_run_facts goes: only agent_work read it, and no role could.

drop function public.agent_run_facts(uuid, uuid);

-- Each Agent the reader sees, with whether it works now, its failure that is the reader's to see, its work times and the
-- reader's own marks. Security definer for the Runs and the marks; it answers only for the reader and the Agents they see.
--  working     a Conversation of the Agent with a person's message no reply, end or answering Handover followed; a
--              channel Run of it still open and not behind an earlier open turn on its message (#152); an open note Run;
--              a Handover leg to it or back from it under way; or a Routine the worker saw running in the last two minutes.
--  started_at  its newest work that began: a person's message that started a Run in its chat, a channel or note Run, a
--              Handover leg to or from it, a Routine running.
--  worked_at   that, or the newest end of any of them, whichever is later.
--  last seen   the newest ended Run the reader can see: in their own Conversations (not one another Agent answered by a
--              Handover), the channels they are in, the notes of the Cards they see, and the Handover legs of the Agent in
--              those places; and whether a person wrote there after it.
create or replace function public.agent_work(c uuid)
returns table(agent uuid, working boolean, failed_at timestamptz, failed_conversation uuid, failed_channel uuid, failed_card bigint,
 last_work_at timestamptz, created_at timestamptz, woken_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare reader uuid := auth.uid();
begin
 if reader is null or not public.is_member(c) then return; end if;
 return query
 with seen_agents as (
  select h.id, h.created_at from public.hermes_agents h where h.company_id=c and public.can_see_agent(c, h.id)
 ),
 chats as (
  select cv.id, cv.agent_id, cv.person_id from public.conversations cv join seen_agents a on a.id=cv.agent_id where cv.company_id=c
 ),
 -- The channels the reader is in, asked once each.
 my_channels as (select k.id from public.channels k where k.company_id=c and public.in_channel(k.id)),
 -- A Conversation's person's messages, each with whether its Run is still open (conversation_open_run's rule).
 asked as (
  select cv.agent_id, m.created_at, m.run_id,
   not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
   and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)
   and not exists(select 1 from public.agent_handovers h where h.conversation_id=m.conversation_id and h.run_id=m.run_id and h.answers_person) open
  from chats cv join public.conversation_messages m on m.conversation_id=cv.id where m.author='person'
 ),
 channel_work as (
  select r.agent_id, r.message_id, r.ordinal, r.channel_id, r.created_at, r.closed_at, r.outcome from public.channel_runs r
  join seen_agents a on a.id=r.agent_id where r.company_id=c
 ),
 note_work as (
  select n.agent_id, n.card_id, n.created_at, n.closed_at, n.outcome from public.note_runs n
  join seen_agents a on a.id=n.agent_id where n.company_id=c
 ),
 -- A Handover's two Agents, each with the leg that is theirs: the target's, and the follow-up of the Agent that handed it.
 handed as (
  select a.id agent_id, h.* from public.agent_handovers h join seen_agents a on a.id in (h.to_agent, h.from_agent) where h.company_id=c
 ),
 -- Every fact of work, one row each: whether it is open, when it began, when it ended.
 facts as (
  select agent_id, open, case when run_id is not null then created_at end began, null::timestamptz ended from asked
  union all select cv.agent_id, false, null, e.recorded_at from chats cv join public.conversation_run_ends e on e.conversation_id=cv.id
  union all select w.agent_id, w.outcome is null
    and not exists(select 1 from public.channel_runs q where q.message_id=w.message_id and q.outcome is null and q.ordinal<w.ordinal),
   w.created_at, w.closed_at from channel_work w
  union all select agent_id, outcome is null, created_at, closed_at from note_work
  union all select agent_id, to_agent=agent_id and state in ('waiting','target') or from_agent=agent_id and state in ('returning','follow_up'),
   greatest(created_at, return_started_at, answer_started_at), greatest(closed_at, target_closed_at) from handed
  union all select r.agent_id, r.seen_at > now() - interval '2 minutes', r.started_at, null from public.routine_runs_open r
   join seen_agents a on a.id=r.agent_id where r.company_id=c
  union all select r.agent_id, false, null, r.ended_at from public.routine_results r join seen_agents a on a.id=r.agent_id where r.company_id=c
 ),
 work as (
  select agent_id, bool_or(open) working, max(began) started_at, greatest(max(began), max(ended)) worked_at from facts group by agent_id
 ),
 -- The ended Runs the reader can see, each where it ran.
 seen as (
  select cv.agent_id, e.recorded_at at, e.outcome, cv.id conversation, null::uuid channel, null::bigint card
   from chats cv join public.conversation_run_ends e on e.conversation_id=cv.id
   where cv.person_id=reader
    and not exists(select 1 from public.agent_handovers h where h.conversation_id=cv.id and h.run_id=e.run_id and h.answers_person)
  union all
  select w.agent_id, w.closed_at, w.outcome, null, w.channel_id, null from channel_work w join my_channels k on k.id=w.channel_id
   where w.outcome is not null
  union all
  select n.agent_id, n.closed_at, n.outcome, null, null, n.card_id from note_work n
   where n.outcome is not null and n.card_id in (select v.card_id from (select distinct card_id from note_work where outcome is not null) v
    where public.can_see_card(c, v.card_id))
  union all
  select h.agent_id, case when h.agent_id=h.to_agent then coalesce(h.target_closed_at, h.closed_at) else h.closed_at end,
   case when h.agent_id=h.to_agent then h.target_outcome else h.follow_up_outcome end, v.id, k.id, null from handed h
   left join public.conversations v on v.id=h.conversation_id and v.person_id=reader
   left join public.channel_messages m on m.id=h.channel_message_id
   left join my_channels k on k.id=m.channel_id
   where (v.id is not null or k.id is not null)
    and (h.agent_id=h.to_agent and h.target_outcome is not null
     or h.agent_id=h.from_agent and h.follow_up_outcome is not null and h.closed_at is not null)
 ),
 last_seen as (select distinct on (s.agent_id) s.* from seen s where s.at is not null order by s.agent_id, s.at desc),
 facts_of as (
  select a.id, a.created_at, w.working, w.started_at, w.worked_at, l.at ended_at, l.outcome,
   l.conversation, l.channel, l.card,
   case when l.at is null then false
    when l.conversation is not null then exists(select 1 from public.conversation_messages m
     where m.conversation_id=l.conversation and m.author='person' and m.created_at>l.at)
    when l.channel is not null then exists(select 1 from public.channel_messages m
     where m.channel_id=l.channel and m.author='person' and m.created_at>l.at)
    else exists(select 1 from public.work_comments w
     where w.company_id=c and w.card_id=l.card and w.author_id is not null and w.created_at>l.at) end followed
  from seen_agents a left join work w on w.agent_id=a.id left join last_seen l on l.agent_id=a.id
 )
 select f.id, coalesce(f.working, false), s.at, s.conversation, s.channel, s.card, f.worked_at, f.created_at, k.woken_at
 from facts_of f
 left join public.agent_reader_marks k on k.person_id=reader and k.agent_id=f.id
 left join lateral (select f.ended_at at, f.conversation, f.channel, f.card
  where f.outcome not in ('completed','stopped') and not f.followed and f.ended_at > now() - interval '24 hours'
   and (f.started_at is null or f.started_at <= f.ended_at)
   and (k.failure_seen_at is null or k.failure_seen_at < f.ended_at)) s on true;
end $$;
revoke all on function public.agent_work(uuid) from public, anon, authenticated, service_role;
grant execute on function public.agent_work(uuid) to authenticated;

-- "Waiting on you" (20270415100000's waiting_list), unchanged, as a PL/pgSQL function: the same query, whose plan the
-- database keeps between calls on a connection instead of planning its eleven parts on every page and every poll.
create or replace function public.waiting_list(c uuid)
returns table(kind text, id bigint, title text, body text, asked_by text, card_id bigint, conversation_id uuid, created_at timestamptz)
language plpgsql stable set search_path='' as $$
#variable_conflict use_column
begin
 return query select * from (
  select 'approval'::text, w.id, w.title, coalesce(a.name,''), ''::text, w.id, null::uuid, coalesce(w.review_entered_at,w.created_at)
   from public.work_cards w
   join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id and s.kind='review'
   left join public.approval_steps a on a.company_id=w.company_id and a.id=w.approval_step_id
   where w.company_id=c and w.approval_step_id is not null and public.approval_holds(c,w.approval_step_id)
  union all
  select i.kind, i.id, i.title, i.body, i.asked_by, i.card_id, i.conversation_id, i.created_at
   from public.waiting_items i where i.company_id=c and i.person_id=auth.uid() and i.resolved_at is null
  union all
  select 'agent_request'::text, r.id, r.agent_name, r.job, coalesce(p.name,''), null::bigint, null::uuid, r.created_at
   from public.lead_agent_requests r
   join public.members m on m.company_id=r.company_id and m.person_id=r.asked_by and m.removed_at is null
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and r.state='waiting' and public.is_company_owner(c)
  union all
  select r.kind, r.id, case r.kind when 'question' then r.content->>'question' else r.title end, ''::text, v.agent_name,
    (select w.id from public.work_cards w where w.company_id=c and w.conversation_id=r.conversation_id), r.conversation_id, r.created_at
   from public.reply_cards r
   join public.conversations v on v.id=r.conversation_id and v.company_id=r.company_id
   where r.company_id=c and r.kind in ('question','hand','permission') and v.person_id=auth.uid() and public.reply_card_waits(r)
  union all
  select 'channel_permission'::text, p.id, p.title, ''::text, r.agent_name, null::bigint, null::uuid, p.created_at
   from public.channel_permissions p
   join public.channel_runs r on r.message_id=p.message_id and r.ordinal=p.ordinal
   where p.company_id=c and p.state='open' and public.channel_permission_waits(p)
  union all
  select 'channel_question'::text, r.id, r.content->>'question', ''::text, cr.agent_name, null::bigint, null::uuid, r.created_at
   from public.reply_cards r
   join public.channel_messages m on m.id=r.channel_message_id
   join public.channel_runs cr on cr.message_id=r.channel_message_id and cr.ordinal=coalesce(r.channel_ordinal,1)
   where r.company_id=c and r.kind='question' and r.state='open' and cr.outcome is null
    and public.conversation_can_write(c) and public.in_channel(m.channel_id)
    and (r.addressed_to is null or r.addressed_to=auth.uid())
  union all
  select 'channel_hand'::text, r.id, r.title, ''::text, cr.agent_name, null::bigint, null::uuid, r.created_at
   from public.reply_cards r
   join public.channel_messages m on m.id=r.channel_message_id
   join public.channel_runs cr on cr.message_id=r.channel_message_id and cr.ordinal=coalesce(r.channel_ordinal,1)
   where r.company_id=c and r.kind='hand' and r.state='open'
    and public.conversation_can_write(c) and public.in_channel(m.channel_id)
  union all
  select 'agent_key'::text, k.id, g.name, ''::text, ''::text, null::bigint, null::uuid, k.created_at
   from public.agent_key_waits k
   join public.hermes_agents g on g.company_id=k.company_id and g.id=k.agent_id
   where k.company_id=c and public.agent_key_waits_shown(c)
  union all
  select 'agent_change'::text, p.id, g.name, p.change, b.name, null::bigint, null::uuid, p.created_at
   from public.agent_change_proposals p
   join public.hermes_agents g on g.company_id=p.company_id and g.id=p.agent_id
   join public.hermes_agents b on b.company_id=p.company_id and b.id=p.proposed_by
   where p.company_id=c and p.state in ('waiting','applying') and public.is_company_owner(c)
  union all
  select 'agent_access'::text, r.id, g.name, g.speciality, coalesce(p.name,''), null::bigint, null::uuid, r.pressed_at
   from public.agent_access_requests r
   join public.hermes_agents g on g.company_id=r.company_id and g.id=r.agent_id
   join public.members m on m.company_id=r.company_id and m.person_id=r.asked_by and m.removed_at is null
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and public.agent_access_waits(r)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
end $$;

-- The one state read: as the reader, so their own waiting list and its read rules apply. An item is the Agent's by its
-- Conversation, its Card, its rule, its channel message, its channel Run, or the Agent it names. Each item looks up its
-- own rows by key, so a table's read rules are asked of those rows alone, never of every row of the Company.
create or replace function public.agent_face_states(c uuid)
returns table(agent uuid, state text, working boolean, waiting boolean, failed_at timestamptz, failed_conversation uuid,
 failed_channel uuid, failed_card bigint, last_work_at timestamptz, created_at timestamptz, woken_at timestamptz)
language plpgsql stable set search_path='' as $$
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
  ) x where x.agent is not null);
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
revoke all on function public.agent_face_states(uuid) from public, anon, authenticated, service_role;
grant execute on function public.agent_face_states(uuid) to authenticated;
