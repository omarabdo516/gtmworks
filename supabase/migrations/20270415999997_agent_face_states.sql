-- #699 (spec #694, decision 0067): one read answers, for the reader, the state of every Agent they see: waiting on them,
-- working on anything, stuck, asleep or idle, in that order, with what the face needs beside it.
--  working  any open Run of the Agent: a Conversation's, a channel's, a Card note's, a Handover leg's, whoever started it.
--           Nothing else of it is told. A Routine has no open record in the database (the Engine runs it and the worker
--           keeps only its end, routine_results), so a running Routine is not working here; its end is work for asleep.
--  waiting  anything of the Agent's in the reader's own "Waiting on you" (waiting_list, read as the reader), which holds
--           the questions and permissions open in their own Conversations and in the channels they are in.
--  stuck    the last ended Run the reader can see failed (any outcome but completed or stopped), within the last 24 hours,
--           no person wrote in its place after it, no work of the Agent started after it, and the reader has not opened
--           its place since (see_agent_failure, kept per person).
--  asleep   no work of any kind for 7 days, the Agent made over 7 days ago, and the reader has not opened its chat in
--           those 7 days (wake_agent, kept per person in the database, so it holds on every device).
-- Additive, for the previous release: agent_states(uuid) keeps its shape and meaning until its readers move here; one
-- table, indexes and the functions below are new.

-- What each person has done that changes an Agent's state for them alone: since when they have seen where it last
-- failed, and when they last opened its chat. Removed with the Agent or the person.
create table public.agent_reader_marks (
 company_id uuid not null references public.companies(id) on delete cascade,
 person_id uuid not null references public.people(id) on delete cascade,
 agent_id uuid not null,
 failure_seen_at timestamptz,
 woken_at timestamptz,
 primary key (person_id, agent_id),
 foreign key (company_id, agent_id) references public.hermes_agents(company_id, id) on delete cascade
);
create index agent_reader_marks_agent on public.agent_reader_marks(company_id, agent_id);
-- Read and written by the functions below only.
alter table public.agent_reader_marks enable row level security;
revoke all on public.agent_reader_marks from anon, authenticated, service_role;

create index channel_runs_agent on public.channel_runs(company_id, agent_id, created_at desc) where agent_id is not null;
create index note_runs_agent on public.note_runs(company_id, agent_id, created_at desc);
create index agent_handovers_to_agent on public.agent_handovers(to_agent);
create index agent_handovers_from_agent on public.agent_handovers(from_agent);
create index routine_results_agent on public.routine_results(agent_id, ended_at desc);

-- The Runs of an Agent, as facts for the state: whether one is open, when its newest work started and when it last
-- worked at all, and the reader's own last ended Run they can see, with its place and outcome. Security definer, for
-- the Runs of places the reader cannot read; it answers only for an Agent the reader sees, and of other people's Runs
-- tells only open and when.
create function public.agent_run_facts(c uuid, agent uuid)
returns table(working boolean, started_at timestamptz, worked_at timestamptz, ended_at timestamptz, outcome text,
 at_conversation uuid, at_channel uuid, at_card bigint, followed boolean)
language sql stable security definer set search_path='' as $$
 with chats as (select cv.id, cv.person_id from public.conversations cv where cv.company_id=c and cv.agent_id=agent),
 -- The reader's ended Runs they can see: their own Conversations', the channels they are in, the Cards' notes, and the
 -- Handover legs of the Agent in those places. A Conversation's Run another Agent answered by a Handover is that
 -- Agent's leg, not this one's.
 seen as (
  select e.recorded_at at, e.outcome, cv.id conversation, null::uuid channel, null::bigint card
   from chats cv join public.conversation_run_ends e on e.conversation_id=cv.id
   where cv.person_id=auth.uid()
    and not exists(select 1 from public.agent_handovers h where h.conversation_id=cv.id and h.run_id=e.run_id and h.answers_person)
  union all
  select r.closed_at, r.outcome, null, r.channel_id, null from public.channel_runs r
   where r.company_id=c and r.agent_id=agent and r.outcome is not null and public.in_channel(r.channel_id)
  union all
  select n.closed_at, n.outcome, null, null, n.card_id from public.note_runs n
   where n.company_id=c and n.agent_id=agent and n.outcome is not null
  union all
  select coalesce(h.target_closed_at, h.closed_at), h.target_outcome, v.id, m.channel_id, null from public.agent_handovers h
   left join public.conversations v on v.id=h.conversation_id and v.person_id=auth.uid()
   left join public.channel_messages m on m.id=h.channel_message_id and public.in_channel(m.channel_id)
   where h.company_id=c and h.to_agent=agent and h.target_outcome is not null and (v.id is not null or m.id is not null)
  union all
  select h.closed_at, h.follow_up_outcome, v.id, m.channel_id, null from public.agent_handovers h
   left join public.conversations v on v.id=h.conversation_id and v.person_id=auth.uid()
   left join public.channel_messages m on m.id=h.channel_message_id and public.in_channel(m.channel_id)
   where h.company_id=c and h.from_agent=agent and h.follow_up_outcome is not null and h.closed_at is not null
    and (v.id is not null or m.id is not null)
 ),
 last_seen as (select * from seen where at is not null order by at desc limit 1),
 starts as (
  select max(m.created_at) at from chats cv join public.conversation_messages m on m.conversation_id=cv.id
   where m.author='person' and m.run_id is not null
  union all select max(r.created_at) from public.channel_runs r where r.company_id=c and r.agent_id=agent
  union all select max(n.created_at) from public.note_runs n where n.company_id=c and n.agent_id=agent
  union all select max(greatest(h.created_at, h.return_started_at, h.answer_started_at)) from public.agent_handovers h
   where h.company_id=c and (h.to_agent=agent or h.from_agent=agent)
 ),
 ends as (
  select max(e.recorded_at) at from chats cv join public.conversation_run_ends e on e.conversation_id=cv.id
  union all select max(r.closed_at) from public.channel_runs r where r.company_id=c and r.agent_id=agent
  union all select max(n.closed_at) from public.note_runs n where n.company_id=c and n.agent_id=agent
  union all select max(greatest(h.closed_at, h.target_closed_at)) from public.agent_handovers h
   where h.company_id=c and (h.to_agent=agent or h.from_agent=agent)
  union all select max(r.ended_at) from public.routine_results r where r.company_id=c and r.agent_id=agent
 )
 select
  exists(select 1 from chats cv cross join lateral public.conversation_open_run(cv.id))
   or exists(select 1 from public.channel_runs r where r.company_id=c and r.agent_id=agent and r.outcome is null)
   or exists(select 1 from public.note_runs n where n.company_id=c and n.agent_id=agent and n.outcome is null)
   or exists(select 1 from public.agent_handovers h where h.company_id=c
    and (h.to_agent=agent and h.state in ('waiting','target') or h.from_agent=agent and h.state in ('returning','follow_up'))),
  (select max(at) from starts),
  greatest((select max(at) from starts), (select max(at) from ends)),
  l.at, l.outcome, l.conversation, l.channel, l.card,
  case when l.at is null then false
   when l.conversation is not null then exists(select 1 from public.conversation_messages m
    where m.conversation_id=l.conversation and m.author='person' and m.created_at>l.at)
   when l.channel is not null then exists(select 1 from public.channel_messages m
    where m.channel_id=l.channel and m.author='person' and m.created_at>l.at)
   else exists(select 1 from public.work_comments w
    where w.company_id=c and w.card_id=l.card and w.author_id is not null and w.created_at>l.at) end
 from (select 1) one left join last_seen l on true
 where public.can_see_agent(c, agent);
$$;
revoke all on function public.agent_run_facts(uuid,uuid) from public, anon, authenticated, service_role;

-- Each Agent the reader sees, with its working, its failure that is the reader's to see, its work times and the reader's
-- own marks. Security definer for the Runs and the marks; it answers only for the reader and the Agents they see.
create function public.agent_work(c uuid)
returns table(agent uuid, working boolean, failed_at timestamptz, failed_conversation uuid, failed_channel uuid, failed_card bigint,
 last_work_at timestamptz, created_at timestamptz, woken_at timestamptz)
language sql stable security definer set search_path='' as $$
 select h.id, f.working, s.at, s.conversation, s.channel, s.card, f.worked_at, h.created_at, k.woken_at
 from public.hermes_agents h
 cross join lateral public.agent_run_facts(c, h.id) f
 left join public.agent_reader_marks k on k.person_id=auth.uid() and k.agent_id=h.id
 left join lateral (select f.ended_at at, f.at_conversation conversation, f.at_channel channel, f.at_card card
  where f.outcome not in ('completed','stopped') and not f.followed and f.ended_at > now() - interval '24 hours'
   and (f.started_at is null or f.started_at <= f.ended_at)
   and (k.failure_seen_at is null or k.failure_seen_at < f.ended_at)) s on true
 where h.company_id=c and auth.uid() is not null and public.can_see_agent(c, h.id);
$$;
revoke all on function public.agent_work(uuid) from public, anon, authenticated, service_role;
grant execute on function public.agent_work(uuid) to authenticated;

-- The one state read: as the reader, so their own waiting list and its read rules apply. An item is the Agent's by its
-- Conversation, its Card, its channel Run, its rule, its channel message, or the Agent it names.
create function public.agent_face_states(c uuid)
returns table(agent uuid, state text, working boolean, waiting boolean, failed_at timestamptz, failed_conversation uuid,
 failed_channel uuid, failed_card bigint, last_work_at timestamptz, created_at timestamptz, woken_at timestamptz)
language sql stable set search_path='' as $$
 with mine as (select * from public.waiting_list(c)),
 asking as (
  select v.agent_id agent from mine w join public.conversations v on v.id=w.conversation_id and v.company_id=c
  union select k.agent_id from mine w join public.work_cards k on k.id=w.card_id and k.company_id=c
  union select r.agent_id from mine w join public.waiting_items i on i.id=w.id and i.kind=w.kind and i.company_id=c
   join public.agent_rules r on r.id=i.agent_rule_id where w.kind='rule_suggestion'
  union select m.agent_id from mine w join public.waiting_items i on i.id=w.id and i.kind=w.kind and i.company_id=c
   join public.channel_messages m on m.id=i.channel_message_id where w.kind='channel_mention'
  union select r.agent_id from mine w join public.channel_permissions p on p.id=w.id and p.company_id=c
   join public.channel_runs r on r.message_id=p.message_id and r.ordinal=p.ordinal where w.kind='channel_permission'
  union select r.agent_id from mine w join public.reply_cards q on q.id=w.id and q.company_id=c
   join public.channel_runs r on r.message_id=q.channel_message_id and r.ordinal=coalesce(q.channel_ordinal,1)
   where w.kind in ('channel_question','channel_hand')
  union select k.agent_id from mine w join public.agent_key_waits k on k.id=w.id and k.company_id=c where w.kind='agent_key'
  union select unnest(array[p.agent_id, p.proposed_by]) from mine w join public.agent_change_proposals p on p.id=w.id and p.company_id=c
   where w.kind='agent_change'
  union select r.agent_id from mine w join public.agent_access_requests r on r.id=w.id and r.company_id=c where w.kind='agent_access'
 )
 select a.agent,
  case when s.waiting then 'waiting' when a.working then 'working' when a.failed_at is not null then 'stuck'
   when coalesce(a.created_at, '-infinity') < now() - interval '7 days'
    and coalesce(greatest(a.last_work_at, a.woken_at), '-infinity') < now() - interval '7 days' then 'asleep'
   else 'idle' end,
  a.working, s.waiting, a.failed_at, a.failed_conversation, a.failed_channel, a.failed_card, a.last_work_at, a.created_at, a.woken_at
 from public.agent_work(c) a
 cross join lateral (select exists(select 1 from asking where asking.agent=a.agent) waiting) s;
$$;
revoke all on function public.agent_face_states(uuid) from public, anon, authenticated, service_role;
grant execute on function public.agent_face_states(uuid) to authenticated;

-- The reader opened a place (a Conversation, a channel or a Card): every failure of an Agent they see that is theirs
-- to see there is seen, until the Agent fails again. Answers how many Agents it cleared.
create function public.see_agent_failure(c uuid, conversation uuid default null, channel uuid default null, card bigint default null)
returns integer language plpgsql security definer set search_path='' as $$
declare cleared integer;
begin
 if auth.uid() is null or num_nonnulls(conversation, channel, card) <> 1 then return 0; end if;
 insert into public.agent_reader_marks(company_id, person_id, agent_id, failure_seen_at)
  select c, auth.uid(), w.agent, now() from public.agent_work(c) w
  where w.failed_conversation is not distinct from conversation and w.failed_channel is not distinct from channel
   and w.failed_card is not distinct from card
  on conflict (person_id, agent_id) do update set failure_seen_at=excluded.failure_seen_at;
 get diagnostics cleared = row_count;
 return cleared;
end $$;
revoke all on function public.see_agent_failure(uuid,uuid,uuid,bigint) from public, anon, authenticated, service_role;
grant execute on function public.see_agent_failure(uuid,uuid,uuid,bigint) to authenticated;

-- The reader opened the Agent's chat: it is awake for them for the next 7 days. False for an Agent they do not see.
create function public.wake_agent(c uuid, agent uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.can_see_agent(c, agent) then return false; end if;
 insert into public.agent_reader_marks(company_id, person_id, agent_id, woken_at) values (c, auth.uid(), agent, now())
  on conflict (person_id, agent_id) do update set woken_at=excluded.woken_at;
 return true;
end $$;
revoke all on function public.wake_agent(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.wake_agent(uuid,uuid) to authenticated;
