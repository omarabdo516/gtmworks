-- #478 (spec #474, decision 0057): with no limit on Handovers, the person's Stop ends the whole chain. Stop in a
-- Conversation, and Stop on a channel message's Run, also end every open Handover started from that chat or that
-- message, down the whole chain: each ends as stopped (`done`, with the leg it was on stopped), so no answer and no
-- follow-up starts after it, and the Runs they had going are named so the app stops each on its own Agent's Engine. A
-- channel message's other Agents not started yet do not start, and other messages' work goes on.
--
-- A stopped Handover's row says so (`stopped`), in place of "the job didn't finish".
--
-- Additive only, for the previous app version: no column is added or changed, every replaced function keeps its
-- signature but conversation_handovers and channel_handovers, whose answers gain one last column and are read by column
-- name; that version's Stop still stops the chat's own Run as before.

-- Every open Handover of a Conversation, or of one channel message, ends as stopped, in one statement: the leg it was on
-- is the one stopped (the asked Agent's job, its wait for its children or its answer; or, once it answered, the asking
-- Agent's follow-up). A job command's Handover (#358) is the person's own Run, so its chat records that Run as stopped,
-- as close_handover_target does for its other endings. Answers one row per Handover ended, with the Run it had going
-- and that Run's profile, or none for a leg with no Run started.
create function public.stop_open_handovers(conversation uuid, message bigint)
returns table(handover bigint, run text, profile text)
language plpgsql security definer set search_path='' as $$
begin
 return query
 with open as (
  select h.id, h.state as was, h.parent_id, h.answers_person, h.company_id, h.conversation_id, h.run_id,
   case h.state when 'target' then h.target_run when 'answering' then h.answer_run when 'follow_up' then h.follow_up_run end as going,
   case h.state when 'target' then t.profile when 'answering' then t.profile when 'follow_up' then f.profile end as on_profile
  from public.agent_handovers h
   join public.hermes_agents t on t.id=h.to_agent
   join public.hermes_agents f on f.id=h.from_agent
  where h.state not in ('done','failed')
   and ((stop_open_handovers.conversation is not null and h.conversation_id=stop_open_handovers.conversation)
    or (stop_open_handovers.message is not null and h.channel_message_id=stop_open_handovers.message))
  order by h.id
  for update of h
 ), ended as (
  update public.agent_handovers h set state='done', closed_at=now(), attempted_at=null,
   target_outcome=case when o.was in ('waiting','target','handing','answering') then 'stopped' else h.target_outcome end,
   target_closed_at=case when o.was in ('waiting','target','handing','answering') then now() else h.target_closed_at end,
   follow_up_outcome=case when o.was in ('returning','follow_up') and o.parent_id is null and not o.answers_person then 'stopped' else h.follow_up_outcome end
  from open o where h.id=o.id
  returning h.id, o.going, o.on_profile, o.answers_person, o.company_id, o.conversation_id, o.run_id
 ), told as (
  insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
   select e.company_id,e.conversation_id,e.run_id,'stopped' from ended e where e.answers_person and e.conversation_id is not null
   on conflict do nothing
 )
 select e.id, e.going, case when e.going is not null then e.on_profile end from ended e order by e.id;
end $$;
revoke all on function public.stop_open_handovers(uuid,bigint) from public,anon,authenticated,service_role;

-- Whether a Handover ended because its person pressed Stop (or the Engine stopped the Run it was on): the worker asks
-- when a Run id came back for a leg that had already ended, and stops that Run (lib/handovers.mjs).
create function public.handover_stopped(h bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agent_handovers x where x.id=h and x.state='done'
  and (x.target_outcome='stopped' or x.follow_up_outcome='stopped'));
$$;
revoke all on function public.handover_stopped(bigint) from public,anon,authenticated;
grant execute on function public.handover_stopped(bigint) to service_role;

-- Stop in a Conversation (lib/conversation-runs.mjs, beside conversation_stop_target for the chat's own Run): its open
-- Handovers end as stopped, on the rule that Run's Stop keeps: the Conversation's person, or a Manager or Owner of the
-- Company. Nothing open answers no row.
create function public.stop_conversation_handovers(conversation uuid, c uuid) returns table(run text, profile text)
language plpgsql security definer set search_path='' as $$
declare talk public.conversations;
begin
 select * into talk from public.conversations cv where cv.id=stop_conversation_handovers.conversation and cv.company_id=c;
 if auth.uid() is null or not public.is_member(c) or talk.id is null or not public.can_see_conversation_agent(c,talk.id) then
  raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if not exists(select 1 from public.agent_handovers h where h.conversation_id=talk.id and h.state not in ('done','failed')) then return; end if;
 if talk.person_id is distinct from auth.uid() and not public.can_manage_company(c) then raise exception 'conversationStopNotAllowed' using errcode='42501'; end if;
 return query select s.run, s.profile from public.stop_open_handovers(talk.id,null) s;
end $$;
revoke all on function public.stop_conversation_handovers(uuid,uuid) from public,anon,service_role;
grant execute on function public.stop_conversation_handovers(uuid,uuid) to authenticated;

-- Stop on a channel message's Run (lib/channel-runs.mjs): the person who wrote it, or a Manager or Owner of the Company,
-- while they may write and are in the channel. The message's Runs not started yet end as stopped at once, so no later
-- Agent of it starts; every open Handover started from it ends as stopped. Answers the Runs to stop on their Engines (its
-- own started Runs, which end as stopped when next closed, and the Handovers'), and one row with none for each thing
-- ended with no Run going. A Run whose start is on its way keeps going, and its message stays stoppable.
create function public.stop_channel_message(c uuid, ch uuid, message bigint) returns table(run text, profile text)
language plpgsql security definer set search_path='' as $$
declare m public.channel_messages;
begin
 if auth.uid() is null or not public.conversation_can_write(c) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 select * into m from public.channel_messages x where x.id=stop_channel_message.message;
 if m.id is null or m.company_id<>c or m.channel_id<>ch or m.author<>'person' or not public.in_channel(ch) then
  raise exception 'channelNotFound' using errcode='P0002'; end if;
 if m.person_id is distinct from auth.uid() and not public.can_manage_company(c) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 return query
  with unstarted as (
   update public.channel_runs r set outcome='stopped', closed_at=now()
    where r.message_id=m.id and r.outcome is null and r.run_id is null and r.attempts=0
    returning r.ordinal)
  select null::text, null::text from unstarted;
 return query select r.run_id, r.profile from public.channel_runs r where r.message_id=m.id and r.outcome is null and r.run_id is not null order by r.ordinal;
 return query select s.run, s.profile from public.stop_open_handovers(null,m.id) s;
end $$;
revoke all on function public.stop_channel_message(uuid,uuid,bigint) from public,anon,service_role;
grant execute on function public.stop_channel_message(uuid,uuid,bigint) to authenticated;

-- The channel message the reader's Stop ends (lib/channels.ts): the newest one with work open, a Run of its own or a
-- Handover started from it, that they may stop, as stop_channel_message rules, with the Agent working on it (its first
-- open Run's, else the Agent that made its first Handover). None when there is nothing to stop.
create function public.channel_stoppable(ch uuid) returns table(message bigint, agent_name text)
language sql stable security definer set search_path='' as $$
 select m.id,
  coalesce((select r.agent_name from public.channel_runs r where r.message_id=m.id and r.outcome is null order by r.ordinal limit 1),
   (select a.name from public.agent_handovers h join public.hermes_agents a on a.id=h.from_agent
    where h.channel_message_id=m.id and h.parent_id is null order by h.id limit 1))
 from public.channel_messages m
  join public.channels k on k.id=m.channel_id and k.company_id=m.company_id
 where m.channel_id=ch and m.author='person' and auth.uid() is not null and public.in_channel(ch)
  and public.conversation_can_write(k.company_id) and (m.person_id=auth.uid() or public.can_manage_company(k.company_id))
  and (exists(select 1 from public.channel_runs r where r.message_id=m.id and r.outcome is null)
   or exists(select 1 from public.agent_handovers h where h.channel_message_id=m.id and h.state not in ('done','failed')))
 order by m.id desc limit 1;
$$;
revoke all on function public.channel_stoppable(uuid) from public,anon,service_role;
grant execute on function public.channel_stoppable(uuid) to authenticated;

-- 20261211000000's conversation_working_for, and a chain still moving: while a Handover of the chat is open, its Agent is
-- working for the Conversation's person, so the chat keeps its Stop square even when no Run of its own is open.
create or replace function public.conversation_working_for(conversation uuid) returns table(person uuid, name text)
language sql stable security definer set search_path='' as $$
 with mine as (select cv.id, cv.person_id from public.conversations cv
  where cv.id=conversation_working_for.conversation and cv.person_id=auth.uid() and public.is_member(cv.company_id))
 select o.person,o.author_name from public.conversation_open_run(conversation) o where exists(select 1 from mine)
 union all
 select mine.person_id,p.name from mine join public.people p on p.id=mine.person_id
 where not exists(select 1 from public.conversation_open_run(conversation))
  and exists(select 1 from public.agent_handovers h where h.conversation_id=mine.id and h.state not in ('done','failed'))
 limit 1;
$$;

-- 20270415990000's conversation_handovers, and whether a row was stopped (`stopped`): the chat says "Stopped" on it in
-- place of "the job didn't finish". Its return type changes, so it is made again; the previous app version reads its
-- columns by name.
drop function public.conversation_handovers(uuid);
create function public.conversation_handovers(conversation uuid)
returns table(id bigint, run text, from_agent uuid, from_name text, from_connection uuid, to_agent uuid, to_name text,
 to_connection uuid, goal text, answer text, state text, target_outcome text, answers_person boolean, created_at timestamptz, answered_at timestamptz,
 parent bigint, stopped boolean)
language sql stable security definer set search_path='' as $$
 select h.id,h.run_id,h.from_agent,f.name,f.connection_id,h.to_agent,t.name,t.connection_id,h.goal,
  case when h.target_outcome='completed' and not h.answers_person then h.summary end,
  h.state,h.target_outcome,h.answers_person,h.created_at,h.target_closed_at,h.parent_id,
  coalesce(h.target_outcome='stopped' or h.follow_up_outcome='stopped',false)
 from public.agent_handovers h
  join public.conversations c on c.id=h.conversation_id and c.company_id=h.company_id
  join public.hermes_agents f on f.id=h.from_agent and f.company_id=h.company_id
  join public.hermes_agents t on t.id=h.to_agent and t.company_id=h.company_id
 where h.conversation_id=conversation_handovers.conversation and auth.uid() is not null and c.person_id=auth.uid()
  and public.is_member(c.company_id) and public.can_see_agent(c.company_id,c.agent_id)
 order by h.created_at,h.id;
$$;
revoke all on function public.conversation_handovers(uuid) from public,anon,service_role;
grant execute on function public.conversation_handovers(uuid) to authenticated;

-- 20270415650000's channel_handovers, and `stopped` after its last column, as the Conversation's.
drop function public.channel_handovers(uuid);
create function public.channel_handovers(ch uuid)
returns table(id bigint, message bigint, from_agent uuid, from_name text, from_connection uuid, to_agent uuid, to_name text,
 to_connection uuid, goal text, summary text, reply text, state text, target_outcome text, created_at timestamptz, answered_at timestamptz,
 closed_at timestamptz, no_model boolean, stopped boolean)
language sql stable security definer set search_path='' as $$
 select h.id,h.channel_message_id,h.from_agent,f.name,f.connection_id,h.to_agent,t.name,t.connection_id,h.goal,h.summary,h.reply,
  h.state,h.target_outcome,h.created_at,h.target_closed_at,h.closed_at,
  h.state in ('done','failed') and h.reply is null and coalesce(coalesce(h.follow_up_outcome,h.target_outcome)='no_model',false),
  coalesce(h.target_outcome='stopped' or h.follow_up_outcome='stopped',false)
 from public.agent_handovers h
  join public.channel_messages m on m.id=h.channel_message_id
  join public.hermes_agents f on f.id=h.from_agent and f.company_id=h.company_id
  join public.hermes_agents t on t.id=h.to_agent and t.company_id=h.company_id
 where m.channel_id=ch and h.company_id=m.company_id and auth.uid() is not null and public.in_channel(ch)
 order by h.id desc;
$$;
revoke all on function public.channel_handovers(uuid) from public,anon,service_role;
grant execute on function public.channel_handovers(uuid) to authenticated;
