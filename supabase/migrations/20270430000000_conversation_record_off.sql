-- #883 (spec #864, ADR 0033 item 1): the old Conversation record is switched off. Every Conversation is its Agent's
-- Engine session, a new one and one the old record held alike: a send starts a Run on the row's session, and a row with
-- no session yet is given one here. Nothing of the old record is read for it any more: its stored messages and files,
-- its queued turns, its Run notes, reservations, resets and ends.
--
-- No table is dropped and no row is deleted, moved or changed: the old record stays as it is until Omar removes it in the
-- removals spec (ADR 0033 item 9). The previous release keeps working on this schema: every function keeps its arguments,
-- and a send it makes in a Conversation the old record held now starts on that Conversation's session, which the
-- previous release reads as it reads any Conversation on the Engine. The Company switch of #876
-- (companies.engine_conversations) decides nothing from here, and leaves in this step's cutover.

-- 20270429000000's check of a send, with no Company switch and no fallback to the old record: the answer is always the
-- Engine's. A row that has no session (a Conversation the old record held before any Run of it closed, the Owner's empty
-- first Conversation) is given one here, chosen by the database as for a new one. A message addressed to a Member has no
-- place in an Engine session: it is refused, and the words stay in the box.
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
 if (select a.person from public.conversation_addressee(c,message) a limit 1) is not null then
  raise exception 'conversationAddressedOnEngine' using errcode='22023';
 end if;
 if existing.id is null then
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id,last_message_at)
   values(conversation,c,auth.uid(),agent,chosen.name,'gtmworks-'||gen_random_uuid()::text,now())
   returning * into existing;
  held := existing.hermes_session_id;
 else
  -- Writing in an archived Conversation brings it back, logged as the person's.
  update public.conversations set hermes_session_id=coalesce(hermes_session_id,'gtmworks-'||gen_random_uuid()::text),
   last_message_at=greatest(last_message_at,now()),archived_at=null,archived_by=null
   where id=conversation returning hermes_session_id into held;
  if existing.archived_at is not null then perform public.log_conversation_archive(conversation,false,auth.uid()); end if;
 end if;
 return jsonb_build_object('state','engine','agent',agent,'session',held,
  'note',(select n.note from public.member_notes n where n.company_id=c and n.person_id=auth.uid()),
  'model',existing.model,'model_before',existing.model_before)
  || case when existing.lead_opening then jsonb_build_object('opening',jsonb_build_object(
   'owner',(select split_part(p.name,' ',1) from public.people p where p.id=auth.uid()),
   'language',(select p.language from public.people p where p.id=auth.uid()),
   'lead',chosen.name,'company',(select o.name from public.companies o where o.id=c))) else '{}'::jsonb end;
end $$;

-- 20270429000000's first Conversation, on the Engine in every Company. A Company is written in once any of its
-- Conversations has a session: a Run started on it, here or on the old record, whose closed Runs kept the session too.
-- The main Agent opens it once, ever: until anyone writes, the Owner's visit goes back to the one it opened. An Owner's
-- Conversation with it that has no session yet is the one it marks, whatever the old record holds of it.
create or replace function public.open_first_conversation(c uuid, person uuid, conversation uuid, body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare lead public.hermes_agents; target uuid; written boolean;
begin
 perform 1 from public.companies where id=c for update;
 if not found then return null; end if;
 written := exists(select 1 from public.conversations v where v.company_id=c and v.hermes_session_id is not null);
 select v.id into target from public.conversations v where v.company_id=c and v.lead_opening and v.person_id=person;
 if found then return case when not written then target end; end if;
 if written or exists(select 1 from public.conversations v where v.company_id=c and v.lead_opening) then return null; end if;
 if not exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role='owner' and m.removed_at is null) then return null; end if;
 select * into lead from public.hermes_agents a where a.company_id=c and a.is_default;
 if not found then return null; end if;
 -- The Owner's empty Conversation with it (first run makes one), else a new one under the given id.
 select v.id into target from public.conversations v where v.company_id=c and v.person_id=person and v.agent_id=lead.id
  and v.hermes_session_id is null
  order by v.id=conversation desc,v.created_at,v.id limit 1;
 if target is null then
  target:=conversation;
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(target,c,person,lead.id,lead.name);
 end if;
 update public.conversations set lead_opening=true where id=target;
 return target;
end $$;

-- 20270429000000's Agent work, without the old record: a Conversation's work is the Run its row holds, and no stored
-- message, Run end or queued turn counts as work or as a failure any more. A Run the old record left open when it was
-- switched off is closed by nobody, so counting it would show its Agent working for good. The Handover's, the Channels',
-- the Card notes' and the Routines' facts are as before.
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
  -- A Conversation's row holds the Run it works on until that Run's end is seen, and its last message is when that work
  -- began (#882).
  select cv.agent_id, true open, cv.last_message_at began, null::timestamptz ended from chats cv where cardinality(cv.open_runs)>0
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
  select w.agent_id, w.closed_at at, w.outcome, null::uuid conversation, w.channel_id channel, null::bigint card from channel_work w join my_channels k on k.id=w.channel_id
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
   -- A Conversation's failure is followed once its person wrote after it: its last message is then later.
   case when l.at is null then false
    when l.conversation is not null then exists(select 1 from public.conversations v
     where v.id=l.conversation and v.last_message_at>l.at)
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

-- The question, the handed step and the request to act a Run of the old record left waiting on its person are answered by
-- nobody now: no closer reads that Run again. "Waiting on you" leaves them out (lib/approval-queue.ts), and so does the
-- face of their Agent, which would wait on the reader for good. A Conversation's Run on the Engine draws what it waits on
-- from its own live read, which no list holds.
create or replace function public.agent_face_states(c uuid) RETURNS TABLE(agent uuid, state text, working boolean, waiting boolean, failed_at timestamp with time zone, failed_conversation uuid, failed_channel uuid, failed_card bigint, last_work_at timestamp with time zone, created_at timestamp with time zone, woken_at timestamp with time zone)
language plpgsql stable set search_path='' set plan_cache_mode='force_generic_plan' as $$
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
  ) x where x.agent is not null and w.kind not in ('approval','mention','question','hand','permission'));
 return query
 select a.agent,
  case when s.waiting then 'waiting' when a.working then 'working' when f.failed_at is not null then 'stuck'
   when coalesce(a.created_at, '-infinity') < now() - interval '7 days'
    and coalesce(greatest(a.last_work_at, a.woken_at), '-infinity') < now() - interval '7 days' then 'asleep'
   else 'idle' end,
  a.working, s.waiting, f.failed_at, f.failed_conversation, f.failed_channel, null::bigint, a.last_work_at, a.created_at, a.woken_at
 from public.agent_work(c) a
 cross join lateral (select a.agent = any(asking) waiting) s
 -- A failure on an old board's Card is no failure here.
 cross join lateral (select case when a.failed_card is null then a.failed_at end failed_at,
  case when a.failed_card is null then a.failed_conversation end failed_conversation,
  case when a.failed_card is null then a.failed_channel end failed_channel) f;
end $$;

-- The Run an Agent works on now, for its details' "Working now" (#141): a Conversation's is the Run its row holds, which
-- began with its last message, and the reader's own Conversation is named so its details can say it is on their request.
-- No stored message of the old record is read for it.
create or replace function public.agent_open_run(c uuid, agent uuid) RETURNS TABLE(started_at timestamp with time zone, my_conversation uuid)
language sql stable security definer set search_path='' as $$
 select cv.last_message_at,case when cv.person_id=auth.uid() then cv.id end
 from public.conversations cv
 where cv.company_id=c and cv.agent_id=agent and cardinality(cv.open_runs)>0 and public.can_see_agent(c,agent)
 order by cv.last_message_at desc,cv.id desc limit 1;
$$;

-- The steps an Agent handed over on its Screen (#714) were cards of a Conversation's Run on the old record, and "Done it"
-- on one queued the turn that told the Agent: no such Run starts or closes any more, so a step left open waits on nobody.
-- The Screen, its banner and the sidebar's poll list none of them; the cards stay in reply_cards as they are.
create or replace function public.screen_hands(c uuid) RETURNS TABLE(card bigint, conversation uuid, agent uuid, agent_name text, title text, app text, step text, created_at timestamp with time zone)
language sql stable security definer set search_path='' as $$
 select null::bigint,null::uuid,null::uuid,null::text,null::text,null::text,null::text,null::timestamptz where false;
$$;
