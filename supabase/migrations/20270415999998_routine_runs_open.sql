-- #699 (spec #694): an Agent running a Routine is working. The Engine schedules and runs a Routine and gtmworks keeps
-- no copy of it (ADR 0016), so the database had only each run's end (routine_results) and a running Routine was not
-- working in agent_face_states. The worker now reads, on each pass of its own loop (lib/routine-runs.mjs, every 15
-- seconds), which Routines of each Agent's profile the Engine runs now (a run it lists as active) and keeps that whole
-- set here for the profile: a Routine that ended is gone on the next pass, and its end is kept in routine_results as
-- before.
-- Bounded: a row is the Agent's work only while the worker saw it in the last two minutes, so a worker that crashed or
-- an Engine that went away leaves the Agent working two minutes at most; the worker itself counts no run the Engine
-- still lists as active hours after it started (lib/routine-runs.mjs), so a run the Engine lost never holds it.
-- Additive, for the previous release: one table and one worker function are new, and agent_run_facts keeps its shape;
-- the previous release's worker keeps nothing here and its readers never read it.
create table public.routine_runs_open (
 company_id uuid not null references public.companies(id) on delete cascade,
 agent_id uuid not null references public.hermes_agents(id) on delete cascade,
 profile text not null check (profile ~ '^(co|ag)-[0-9a-f]{32}$'),
 routine_id text not null check (routine_id ~ '^[0-9a-f]{6,64}$'),
 started_at timestamptz not null,
 seen_at timestamptz not null default now(),
 primary key (company_id, profile, routine_id)
);
create index routine_runs_open_agent on public.routine_runs_open(company_id, agent_id, seen_at desc);
-- The worker alone writes it, through keep_running_routines; agent_run_facts reads it. No Member reads it.
alter table public.routine_runs_open enable row level security;
revoke all on public.routine_runs_open from anon, authenticated, service_role;

-- One pass's set for one profile: the Routines the Engine runs now on it, each with its run's start, for the Agent the
-- worker reads that profile for (an Agent of the Company on that very profile, or nothing is kept). What the set leaves
-- out has ended and goes. Answers how many it holds now.
create function public.keep_running_routines(c uuid, at_profile text, agent uuid, running jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare held integer;
begin
 if running is null or jsonb_typeof(running)<>'array' or jsonb_array_length(running)>500 then raise exception 'runningRoutinesInvalid' using errcode='22023'; end if;
 if not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c and a.profile=at_profile) then return 0; end if;
 delete from public.routine_runs_open r where r.company_id=c and r.profile=at_profile
  and not exists(select 1 from jsonb_array_elements(running) x where x->>'routine_id'=r.routine_id);
 insert into public.routine_runs_open(company_id,agent_id,profile,routine_id,started_at,seen_at)
  select distinct on (x->>'routine_id') c,agent,at_profile,x->>'routine_id',(x->>'started_at')::timestamptz,now()
  from jsonb_array_elements(running) x
  on conflict (company_id,profile,routine_id) do update set agent_id=excluded.agent_id,started_at=excluded.started_at,seen_at=excluded.seen_at;
 select count(*)::int into held from public.routine_runs_open r where r.company_id=c and r.profile=at_profile;
 return held;
end $$;
revoke all on function public.keep_running_routines(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.keep_running_routines(uuid,text,uuid,jsonb) to service_role;

-- The Runs of an Agent, as #699 first read them, with a Routine the worker saw running in the last two minutes open
-- too, and its start the Agent's newest work.
create or replace function public.agent_run_facts(c uuid, agent uuid)
returns table(working boolean, started_at timestamptz, worked_at timestamptz, ended_at timestamptz, outcome text,
 at_conversation uuid, at_channel uuid, at_card bigint, followed boolean)
language sql stable security definer set search_path='' as $$
 with chats as (select cv.id, cv.person_id from public.conversations cv where cv.company_id=c and cv.agent_id=agent),
 -- The reader's ended Runs they can see: their own Conversations', the channels they are in, the notes of the Cards
 -- they see (can_see_card), and the
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
   where n.company_id=c and n.agent_id=agent and n.outcome is not null and public.can_see_card(c, n.card_id)
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
  union all select max(r.started_at) from public.routine_runs_open r where r.company_id=c and r.agent_id=agent
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
   -- A channel message's Agents go one after another (#152): an Agent whose turn waits behind an earlier open one is
   -- not working yet.
   or exists(select 1 from public.channel_runs r where r.company_id=c and r.agent_id=agent and r.outcome is null
    and not exists(select 1 from public.channel_runs q where q.message_id=r.message_id and q.outcome is null and q.ordinal<r.ordinal))
   or exists(select 1 from public.note_runs n where n.company_id=c and n.agent_id=agent and n.outcome is null)
   or exists(select 1 from public.agent_handovers h where h.company_id=c
    and (h.to_agent=agent and h.state in ('waiting','target') or h.from_agent=agent and h.state in ('returning','follow_up')))
   or exists(select 1 from public.routine_runs_open r where r.company_id=c and r.agent_id=agent and r.seen_at > now() - interval '2 minutes'),
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
