-- #882 (spec #864): what a person already uses in a Conversation behaves as today on a Conversation whose messages are
-- the Engine's: the model chosen for it goes with each of its Runs, the main Agent opens a new Company's first
-- Conversation, and the Agent's face shows it working.

-- The Conversation the main Agent opened for a new Company's Owner (#434). Its opening is gtmworks's own words, drawn
-- at the top of it in the Owner's language (lib/lead-opening.mjs): an Engine session holds no message without a Run, and
-- a Run would put a person's message before it. The Owner's answer is the session's first Run, which is told the opening.
alter table public.conversations add column lead_opening boolean not null default false;

-- A Company switched over to the Engine (engine_conversations) is written in once any of its Conversations has a session
-- (a session exists only once a Run was started on it) or the old record holds a person's message. Lead opens it once,
-- ever: until anyone writes, the Owner's visit goes back to the one it opened; the opening is no message, so the
-- Conversation it opened is the row it marks. A Company not switched over is opened on the old record, as before.
create or replace function public.open_first_conversation(c uuid, person uuid, conversation uuid, body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare lead public.hermes_agents; target uuid; written boolean;
begin
 perform 1 from public.companies where id=c for update;
 if not found then return null; end if;
 if coalesce((select o.engine_conversations from public.companies o where o.id=c),false) then
  written := exists(select 1 from public.conversations v where v.company_id=c and v.hermes_session_id is not null)
   or exists(select 1 from public.conversation_messages m where m.company_id=c and public.written_message(m))
   or exists(select 1 from public.conversation_run_reservations r where r.company_id=c);
  select v.id into target from public.conversations v where v.company_id=c and v.lead_opening and v.person_id=person;
  if found then return case when not written then target end; end if;
  if written or exists(select 1 from public.conversations v where v.company_id=c and v.lead_opening) then return null; end if;
  if not exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role='owner' and m.removed_at is null) then return null; end if;
  select * into lead from public.hermes_agents a where a.company_id=c and a.is_default;
  if not found then return null; end if;
  -- The Owner's empty Conversation with it (first run makes one), else a new one under the given id.
  select v.id into target from public.conversations v where v.company_id=c and v.person_id=person and v.agent_id=lead.id
   and v.hermes_session_id is null and not exists(select 1 from public.conversation_messages m where m.conversation_id=v.id)
   and not exists(select 1 from public.conversation_queued_turns q where q.conversation_id=v.id)
   and not exists(select 1 from public.conversation_notes n where n.conversation_id=v.id)
   order by v.id=conversation desc,v.created_at,v.id limit 1;
  if target is null then
   target:=conversation;
   insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(target,c,person,lead.id,lead.name);
  end if;
  update public.conversations set lead_opening=true where id=target;
  return target;
 end if;
 -- Opened already: until anyone writes in the Company, the Owner's visit goes back to it, whichever visit wrote it
 -- (a link's prefetch renders the page too, and its move to the Conversation goes nowhere).
 select m.conversation_id into target from public.conversation_messages m join public.conversations v on v.id=m.conversation_id
  where m.company_id=c and m.run_id='lead-opening' and v.person_id=person;
 if found then
  return case when not exists(select 1 from public.conversation_messages m where m.company_id=c and public.written_message(m))
   and not exists(select 1 from public.conversation_run_reservations r where r.company_id=c) then target end;
 end if;
 -- Opened for another Owner, or written in: never a second opening.
 if exists(select 1 from public.conversation_messages m where m.company_id=c and (m.run_id='lead-opening' or public.written_message(m)))
  or exists(select 1 from public.conversation_run_reservations r where r.company_id=c) then return null; end if;
 if not exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role='owner' and m.removed_at is null) then return null; end if;
 select * into lead from public.hermes_agents a where a.company_id=c and a.is_default;
 if not found then return null; end if;
 select v.id into target from public.conversations v where v.company_id=c and v.person_id=person and v.agent_id=lead.id
  order by v.id=conversation desc,v.created_at,v.id limit 1;
 if target is null then
  target:=conversation;
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(target,c,person,lead.id,lead.name);
 end if;
 insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
  values(c,target,'agent',lead.id,lead.name,body,'lead-opening');
 return target;
end $$;

-- 20270428000000's check of a send, which now also answers the model chosen for the Conversation (#158), for its Run to
-- carry, and, on the Conversation the main Agent opened, the names and the language its opening is said in, so the Owner's answer is
-- told it (lib/conversation-send.ts). That Conversation has no session until its first send gives it one here.
create or replace function public.open_engine_conversation(c uuid, conversation uuid, agent uuid, message text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.conversations; chosen public.hermes_agents; held text;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if conversation is null or message is null then raise exception 'conversationNotFound' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 select * into existing from public.conversations where id=conversation;
 if found then
  if existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is null then raise exception 'conversationNotFound' using errcode='P0002'; end if;
  agent := existing.agent_id;
 end if;
 select * into chosen from public.hermes_agents where id=agent and company_id=c;
 if not found or not public.agent_visible_to(c,auth.uid(),agent) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if existing.id is null then
  -- A new Conversation starts on the Engine only in a Company switched over, and a message addressed to a Member is kept
  -- as a note on the old record, as today.
  if not coalesce((select o.engine_conversations from public.companies o where o.id=c),false)
   or (select a.person from public.conversation_addressee(c,message) a limit 1) is not null then
   return jsonb_build_object('state','old');
  end if;
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id,last_message_at)
   values(conversation,c,auth.uid(),agent,chosen.name,'gtmworks-'||gen_random_uuid()::text,now())
   returning * into existing;
  held := existing.hermes_session_id;
 else
  -- Only a Conversation this path made is on the Engine: it has its session and nothing on the old record. Any other
  -- (one the old record holds, or a row made without a session, such as the Owner's empty first Conversation) stays there,
  -- but the one the main Agent opened in a Company switched over, which takes its session with its first send.
  if existing.hermes_session_id is null and existing.lead_opening
   and coalesce((select o.engine_conversations from public.companies o where o.id=c),false) then
   update public.conversations set hermes_session_id='gtmworks-'||gen_random_uuid()::text where id=conversation
    returning * into existing;
  end if;
  if existing.hermes_session_id is null
   or exists(select 1 from public.conversation_messages m where m.conversation_id=conversation)
   or exists(select 1 from public.conversation_queued_turns q where q.conversation_id=conversation)
   or exists(select 1 from public.conversation_notes n where n.conversation_id=conversation) then
   return jsonb_build_object('state','old');
  end if;
  -- A note to a Member has no place in an Engine session: it is refused, and the words stay in the box.
  if (select a.person from public.conversation_addressee(c,message) a limit 1) is not null then
   raise exception 'conversationAddressedOnEngine' using errcode='22023';
  end if;
  -- Writing in an archived Conversation brings it back, logged as the person's, as on the old record.
  update public.conversations set last_message_at=greatest(last_message_at,now()),archived_at=null,archived_by=null
   where id=conversation returning hermes_session_id into held;
  if existing.archived_at is not null then perform public.log_conversation_archive(conversation,false,auth.uid()); end if;
 end if;
 return jsonb_build_object('state','engine','agent',agent,'session',held,
  'note',(select n.note from public.member_notes n where n.company_id=c and n.person_id=auth.uid()),
  'model',existing.model)
  || case when existing.lead_opening then jsonb_build_object('opening',jsonb_build_object(
   'owner',(select split_part(p.name,' ',1) from public.people p where p.id=auth.uid()),
   'language',(select p.language from public.people p where p.id=auth.uid()),
   'lead',chosen.name,'company',(select o.name from public.companies o where o.id=c))) else '{}'::jsonb end;
end $$;

-- 20270416000008's Agent work, which now also counts the open Run of a Conversation whose messages are the Engine's
-- (#882): its face shows it working, as an open Run of the old record does.
create or replace function public.agent_work(c uuid) RETURNS TABLE(agent uuid, working boolean, failed_at timestamp with time zone, failed_conversation uuid, failed_channel uuid, failed_card bigint, last_work_at timestamp with time zone, created_at timestamp with time zone, woken_at timestamp with time zone)
language plpgsql stable security definer set search_path='' set plan_cache_mode='force_generic_plan' as $$
#variable_conflict use_column
declare reader uuid := auth.uid();
begin
 if reader is null or not public.is_member(c) then return; end if;
 return query
 with seen_agents as (
  select h.id, h.created_at from public.hermes_agents h where h.company_id=c and public.can_see_agent(c, h.id)
 ),
 chats as (
  select cv.id, cv.agent_id, cv.person_id, cv.open_runs, cv.last_message_at from public.conversations cv join seen_agents a on a.id=cv.agent_id where cv.company_id=c
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
 -- A Handover's two Agents, each with the leg that is theirs: the target's, and the follow-up of the Agent that handed it
 -- (never the same Agent, agent_handovers_other_agent): whether it is under way, and how and when it ended.
 handed as (
  select a.id agent_id, h.conversation_id, h.channel_message_id, h.created_at, h.closed_at, h.target_closed_at,
   h.return_started_at, h.answer_started_at,
   case when a.id=h.to_agent then h.state in ('waiting','target') else h.state in ('returning','follow_up') end leg_open,
   case when a.id=h.to_agent then coalesce(h.target_closed_at, h.closed_at) else h.closed_at end leg_closed_at,
   case when a.id=h.to_agent then h.target_outcome
    when h.closed_at is not null then h.follow_up_outcome end leg_outcome
  from public.agent_handovers h join seen_agents a on a.id in (h.to_agent, h.from_agent) where h.company_id=c
 ),
 -- The Cards with an ended note Run the reader may see, asked once each.
 seen_cards as (
  select v.card_id from (select distinct card_id from note_work where outcome is not null) v where public.can_see_card(c, v.card_id)
 ),
 -- Every fact of work, one row each: whether it is open, when it began, when it ended.
 facts as (
  select agent_id, open, case when run_id is not null then created_at end began, null::timestamptz ended from asked
  union all select cv.agent_id, false, null, e.recorded_at from chats cv join public.conversation_run_ends e on e.conversation_id=cv.id
  -- A Conversation whose messages are the Engine's (#882): its row holds the Run it works on until that Run's end is seen,
  -- and its last message is when that work began.
  union all select cv.agent_id, true, cv.last_message_at, null from chats cv where cardinality(cv.open_runs)>0
  union all select w.agent_id, w.outcome is null
    and not exists(select 1 from public.channel_runs q where q.message_id=w.message_id and q.outcome is null and q.ordinal<w.ordinal),
   w.created_at, w.closed_at from channel_work w
  union all select agent_id, outcome is null, created_at, closed_at from note_work
  union all select agent_id, leg_open, greatest(created_at, return_started_at, answer_started_at), greatest(closed_at, target_closed_at)
   from handed
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
  select n.agent_id, n.closed_at, n.outcome, null, null, n.card_id from note_work n join seen_cards v on v.card_id=n.card_id
   where n.outcome is not null
  union all
  select h.agent_id, h.leg_closed_at, h.leg_outcome, v.id, k.id, null from handed h
   left join public.conversations v on v.id=h.conversation_id and v.person_id=reader
   left join public.channel_messages m on m.id=h.channel_message_id
   left join my_channels k on k.id=m.channel_id
   where (v.id is not null or k.id is not null) and h.leg_outcome is not null
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

-- A Run the Engine refused at its start while it named the model chosen for the Conversation (#158): the Conversation
-- goes back to the model it had before, as refuse_run_model does on the old record, and its person is told so. Only its
-- own person, for the model it holds now; answers whether it went back.
create function public.refuse_conversation_model(c uuid, conversation uuid, refused jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if refused is null or jsonb_typeof(refused)='null' then return false; end if;
 update public.conversations cv set model=cv.model_before, model_before=null
  where cv.id=conversation and cv.company_id=c and cv.person_id=auth.uid() and public.is_member(c) and cv.model=refused;
 return found;
end $$;
revoke all on function public.refuse_conversation_model(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.refuse_conversation_model(uuid,uuid,jsonb) to authenticated;

-- The Runs the rows of Engine Conversations hold (#882), for the worker: a Run whose person left the Conversation while it
-- worked has its end seen by no live read, so the worker asks the Engine how each one is and lets go of each that ended
-- or is gone (lib/conversation-held-runs.mjs); the Agent's face then stops showing it working, for every reader.
create function public.held_conversation_runs() returns table(company_id uuid, conversation uuid, profile text, runs text[])
language sql stable security definer set search_path='' as $$
 select v.company_id, v.id, a.profile, v.open_runs
 from public.conversations v join public.hermes_agents a on a.id=v.agent_id and a.company_id=v.company_id
 where cardinality(v.open_runs)>0 and a.profile is not null
 order by v.company_id, v.id;
$$;
revoke all on function public.held_conversation_runs() from public,anon,authenticated,service_role;
grant execute on function public.held_conversation_runs() to service_role;

create function public.let_go_conversation_run(conversation uuid, run text) returns boolean language sql security definer set search_path='' as $$
 with ended as (update public.conversations v set open_runs=array_remove(v.open_runs,run) where v.id=conversation and run=any(v.open_runs) returning 1)
 select exists(select 1 from ended);
$$;
revoke all on function public.let_go_conversation_run(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.let_go_conversation_run(uuid,text) to service_role;
