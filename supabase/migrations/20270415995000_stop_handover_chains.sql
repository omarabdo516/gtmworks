-- #478 (spec #474, decision 0057): with no limit on Handovers, the person's Stop ends the whole chain. Stop in a
-- Conversation, and Stop on a channel message's Run, also end every open Handover started from that chat or that
-- message, down the whole chain: each ends as stopped (`done`, with the leg it was on stopped), so no answer and no
-- follow-up starts after it, and the Runs they had going are named so the app stops each on its own Agent's Engine. A
-- channel message's other Agents not started yet do not start, and other messages' work goes on.
--
-- A stopped Handover's row says so (`stopped`), in place of "the job didn't finish".
--
-- A Run Stop ended a Handover on is kept (`stopping_run`) until its Engine says it ended: the app stops it at once, and
-- the worker asks again on each pass while it still runs, so an Engine that could not be reached at the press still
-- stops it (lib/handovers.mjs).
--
-- Stop and every new Handover take the same lock, on the place's row (the Conversation, or the channel message): a
-- Handover kept while Stop waits is seen and ended by it, and one asked for after Stop finds its chain stopped. A Run
-- of the place's own that was still open at the press (it may already have completed, not yet closed) is kept as
-- stopped (`stopped_runs`), so the calls it made hand nothing on when it closes.
--
-- Additive only, for the previous app version: one nullable column and one table are added, every replaced function keeps its
-- signature but conversation_handovers and channel_handovers, whose answers gain one last column and are read by column
-- name; that version's Stop still stops the chat's own Run as before.

-- The Run a Handover was on when Stop ended it, until its Engine says that Run ended: on the asking Agent's profile when
-- the follow-up was stopped, else on the asked Agent's.
alter table public.agent_handovers add column stopping_run text;
-- The profile that Run runs on, kept with it: the Agent's profile may move once its Handover is done.
alter table public.agent_handovers add column stopping_profile text;
create index agent_handovers_stopping on public.agent_handovers(id) where stopping_run is not null;

-- A Run of a Conversation's or a channel message's own that Stop found still open: its hand_to_agent calls hand nothing
-- on when it closes. Read and written by the database's own functions only.
create table public.stopped_runs (
 company_id uuid not null references public.companies(id) on delete cascade,
 conversation_id uuid references public.conversations(id) on delete cascade,
 channel_message_id bigint references public.channel_messages(id) on delete cascade,
 run_id text not null,
 stopped_at timestamptz not null default now(),
 constraint stopped_runs_one_place check ((conversation_id is null)<>(channel_message_id is null)),
 constraint stopped_runs_once unique nulls not distinct (conversation_id, channel_message_id, run_id)
);
alter table public.stopped_runs enable row level security;
revoke all on public.stopped_runs from anon,authenticated,service_role;

-- Stop asked for while a leg's start was on its way and its answer was lost (attempts made, no Run id yet): only a
-- retry with the same key can learn that Run, so the leg is left to the worker, marked, and ends as stopped the moment
-- its Run id comes back (answer_handover), its Run then stopped as any other.
alter table public.agent_handovers add column stop_requested_at timestamptz;

-- The given open Handovers end as stopped, in one statement: the leg each was on is the one stopped (the asked Agent's
-- job, its wait for its children or its answer; or, once it answered, the asking Agent's follow-up), and the Run it had
-- going is kept to stop (`stopping_run`). A job command's Handover (#358) is the person's own Run, so its chat records
-- that Run as stopped, as close_handover_target does for its other endings. Answers one row per Handover ended, with the
-- Run it had going and that Run's profile, or none for a leg with no Run started.
create function public.end_handovers_stopped(ids bigint[])
returns table(handover bigint, run text, profile text)
language sql security definer set search_path='' as $$
 with open as (
  select h.id, h.state as was, h.parent_id, h.answers_person, h.company_id, h.conversation_id, h.run_id,
   case h.state when 'target' then h.target_run when 'answering' then h.answer_run when 'follow_up' then h.follow_up_run end as going,
   case h.state when 'target' then t.profile when 'answering' then t.profile when 'follow_up' then f.profile end as on_profile
  from public.agent_handovers h
   join public.hermes_agents t on t.id=h.to_agent
   join public.hermes_agents f on f.id=h.from_agent
  where h.id=any(ids) and h.state not in ('done','failed')
  order by h.id
  for update of h
 ), ended as (
  update public.agent_handovers h set state='done', closed_at=now(), attempted_at=null,
   target_outcome=case when o.was in ('waiting','target','handing','answering') then 'stopped' else h.target_outcome end,
   target_closed_at=case when o.was in ('waiting','target','handing','answering') then now() else h.target_closed_at end,
   follow_up_outcome=case when o.was in ('returning','follow_up') and o.parent_id is null and not o.answers_person then 'stopped' else h.follow_up_outcome end,
   stopping_run=o.going, stopping_profile=case when o.going is not null then o.on_profile end
  from open o where h.id=o.id
  returning h.id, o.going, o.on_profile, o.answers_person, o.company_id, o.conversation_id, o.run_id
 ), told as (
  insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
   select e.company_id,e.conversation_id,e.run_id,'stopped' from ended e where e.answers_person and e.conversation_id is not null
   on conflict do nothing
 )
 select e.id, e.going, case when e.going is not null then e.on_profile end from ended e order by e.id;
$$;
revoke all on function public.end_handovers_stopped(bigint[]) from public,anon,authenticated,service_role;

-- Whether a leg's start was sent and its answer lost: attempts made for the leg it is on, and no Run id for it yet.
create function public.handover_start_unsure(h public.agent_handovers) returns boolean
language sql immutable set search_path='' as $$
 select (h.state='waiting' and h.target_attempts>0) or (h.state='handing' and h.answer_attempts>0) or (h.state='returning' and h.return_attempts>0);
$$;
revoke all on function public.handover_start_unsure(public.agent_handovers) from public,anon,authenticated,service_role;

-- Every open Handover of a Conversation, or of one channel message, ends as stopped (end_handovers_stopped), but a leg
-- whose start's answer was lost, which is marked to end so once its Run is known (`stop_requested_at`). Answers one row
-- per Handover Stop reached, with the Run to stop on the Engine now, or none.
create function public.stop_open_handovers(conversation uuid, message bigint)
returns table(handover bigint, run text, profile text)
language plpgsql security definer set search_path='' as $$
declare chain bigint[]; unsure bigint[];
begin
 -- The place's lock first: a Handover being kept there now is committed before the statements below read the chain.
 if stop_open_handovers.conversation is not null then
  perform 1 from public.conversations c where c.id=stop_open_handovers.conversation for no key update;
  insert into public.stopped_runs(company_id,conversation_id,run_id)
   select c.company_id,c.id,m.run_id from public.conversation_messages m join public.conversations c on c.id=m.conversation_id
   where m.conversation_id=stop_open_handovers.conversation and m.author='person'
    and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
    and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)
   on conflict do nothing;
 else
  perform 1 from public.channel_messages x where x.id=stop_open_handovers.message for no key update;
  insert into public.stopped_runs(company_id,channel_message_id,run_id)
   select r.company_id,r.message_id,r.run_id from public.channel_runs r
   where r.message_id=stop_open_handovers.message and r.outcome is null and r.run_id is not null
   on conflict do nothing;
 end if;
 -- The chain's rows next, so a start's answer landing now is either in before they are read, or waits for Stop
 -- (answer_handover locks its row), and every leg is judged as it is.
 perform 1 from public.agent_handovers h
 where h.state not in ('done','failed')
  and ((stop_open_handovers.conversation is not null and h.conversation_id=stop_open_handovers.conversation)
   or (stop_open_handovers.message is not null and h.channel_message_id=stop_open_handovers.message))
 for update;
 select coalesce(array_agg(h.id) filter (where not public.handover_start_unsure(h)),'{}'),
  coalesce(array_agg(h.id) filter (where public.handover_start_unsure(h)),'{}')
  into chain, unsure
 from public.agent_handovers h
 where h.state not in ('done','failed')
  and ((stop_open_handovers.conversation is not null and h.conversation_id=stop_open_handovers.conversation)
   or (stop_open_handovers.message is not null and h.channel_message_id=stop_open_handovers.message));
 update public.agent_handovers h set stop_requested_at=coalesce(h.stop_requested_at,now()) where h.id=any(unsure);
 return query select e.handover, e.run, e.profile from public.end_handovers_stopped(chain) e;
 return query select u, null::text, null::text from unnest(unsure) u;
end $$;
revoke all on function public.stop_open_handovers(uuid,bigint) from public,anon,authenticated,service_role;

-- A Run id came back for a leg Stop had already ended (its start was on its way at the press): kept as the Run to stop,
-- once, and answered true, so the worker stops it (lib/handovers.mjs). False for any other leg that refused the id.
create function public.stop_late_handover_run(h bigint, run text) returns boolean
language plpgsql security definer set search_path='' as $$
declare kept bigint;
begin
 update public.agent_handovers x set stopping_run=coalesce(x.stopping_run,stop_late_handover_run.run),
  stopping_profile=coalesce(x.stopping_profile,(select a.profile from public.hermes_agents a
   where a.id=case when x.follow_up_outcome='stopped' then x.from_agent else x.to_agent end))
  where x.id=h and x.state='done' and (x.target_outcome='stopped' or x.follow_up_outcome='stopped') and coalesce(btrim(stop_late_handover_run.run),'')<>''
  returning x.id into kept;
 return kept is not null;
end $$;
revoke all on function public.stop_late_handover_run(bigint,text) from public,anon,authenticated;
grant execute on function public.stop_late_handover_run(bigint,text) to service_role;

-- The worker's list of Runs Stop ended a Handover on that their Engine has not yet said ended, a page of 500 at a time,
-- each on the profile it ran on (kept with it), else its Agent's. A Run with no profile left has nothing more to ask.
create function public.handover_runs_stopping(after bigint default 0)
returns table(id bigint, run text, profile text, company uuid)
language sql stable security definer set search_path='' as $$
 select x.id, x.stopping_run, coalesce(x.stopping_profile,a.profile), x.company_id from public.agent_handovers x
  left join public.hermes_agents a on a.id=case when x.follow_up_outcome='stopped' then x.from_agent else x.to_agent end
 where x.stopping_run is not null and x.id>coalesce(after,0)
 order by x.id limit 500;
$$;
revoke all on function public.handover_runs_stopping(bigint) from public,anon,authenticated;
grant execute on function public.handover_runs_stopping(bigint) to service_role;

-- That Run's Engine says it ended (or its Agent is gone): nothing is left to stop.
create function public.handover_run_stopped(h bigint, run text) returns boolean
language plpgsql security definer set search_path='' as $$
declare cleared bigint;
begin
 update public.agent_handovers x set stopping_run=null, stopping_profile=null where x.id=h and x.stopping_run=handover_run_stopped.run returning x.id into cleared;
 return cleared is not null;
end $$;
revoke all on function public.handover_run_stopped(bigint,text) from public,anon,authenticated;
grant execute on function public.handover_run_stopped(bigint,text) to service_role;

-- 20270415990000's answer_handover: a leg Stop marked while its start's answer was lost ends as stopped on its start's
-- answer, whatever it is: a Run id is kept, in the same transaction, as the Run to stop, never as the leg's Run (the
-- worker stops it, then keeps stopping it until it ended), and a refusal moves it to no other leg.
do $$
declare def text; was text;
begin
 def:=pg_get_functiondef('public.answer_handover(bigint,integer,text,text)'::regprocedure);
 was:=' if r.id is null or r.state not in (''waiting'',''handing'',''returning'') then return false; end if;';
 if position(was in def)=0 then raise exception 'answer_handover changed: %',def; end if;
 execute replace(def,was,was||E'\n if r.stop_requested_at is not null then\n'
  || E'  perform public.end_handovers_stopped(array[h]);\n'
  || E'  if run is not null then update public.agent_handovers x set stopping_run=coalesce(x.stopping_run,run),\n'
  || E'   stopping_profile=coalesce(x.stopping_profile,(select a.profile from public.hermes_agents a\n'
  || E'    where a.id=case when x.follow_up_outcome=''stopped'' then x.from_agent else x.to_agent end)) where x.id=h; end if;\n'
  || E'  return false;\n'
  || E' end if;');
end $$;

-- 20270415950000's lead_hand_to_agent, 20270415960000's channel_hand_to_agent and 20270415990000's
-- handover_hand_to_agent: each takes its place's lock before it reads what it checks, as Stop does, and the first two
-- refuse a call from a Run Stop found open there.
do $$
declare def text; was text;
begin
 def:=pg_get_functiondef('public.lead_hand_to_agent(uuid,text,text,text,text,text)'::regprocedure);
 was:=' select * into talk from public.conversations where id=conversation;';
 if position(was in def)=0 then raise exception 'lead_hand_to_agent changed: %',def; end if;
 def:=replace(def,was,' select * into talk from public.conversations where id=conversation for no key update;');
 was:=E' if coalesce(agent_name,'''') = '''' or coalesce(goal,'''') = '''' then';
 if position(was in def)=0 then raise exception 'lead_hand_to_agent changed: %',def; end if;
 execute replace(def,was,E' if exists(select 1 from public.stopped_runs s where s.conversation_id=conversation and s.run_id=run)\n'
  || E'  then return jsonb_build_object(''state'',''refused''); end if;\n'||was);

 def:=pg_get_functiondef('public.channel_hand_to_agent(bigint,text,text,text,text,text)'::regprocedure);
 was:=' select * into m from public.channel_messages where id=message;';
 if position(was in def)=0 then raise exception 'channel_hand_to_agent changed: %',def; end if;
 def:=replace(def,was,' select * into m from public.channel_messages where id=message for no key update;');
 was:=E' if coalesce(agent_name,'''')='''' or coalesce(goal,'''')='''' then';
 if position(was in def)=0 then raise exception 'channel_hand_to_agent changed: %',def; end if;
 execute replace(def,was,E' if exists(select 1 from public.stopped_runs s where s.channel_message_id=message and s.run_id=run)\n'
  || E'  then return jsonb_build_object(''state'',''refused''); end if;\n'||was);

 def:=pg_get_functiondef('public.handover_hand_to_agent(bigint,text,text,text,text,text)'::regprocedure);
 was:=' select * into r from public.agent_handovers where id=h;';
 if position(was in def)=0 then raise exception 'handover_hand_to_agent changed: %',def; end if;
 execute replace(def,was,was
  || E'\n if r.conversation_id is not null then perform 1 from public.conversations c where c.id=r.conversation_id for no key update;\n'
  || E' elsif r.channel_message_id is not null then perform 1 from public.channel_messages x where x.id=r.channel_message_id for no key update; end if;\n'
  || E' -- Read again under the lock: a chain Stop ended meanwhile is no longer open.\n'
  || was);
end $$;

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
 if not exists(select 1 from public.agent_handovers h where h.conversation_id=talk.id and h.state not in ('done','failed'))
  and not exists(select 1 from public.conversation_open_run(talk.id)) then return; end if;
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
