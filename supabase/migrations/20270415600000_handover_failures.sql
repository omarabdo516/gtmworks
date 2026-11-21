-- #375, two follow-ups on #354.
--
-- 1. A handover that did not finish is shown to the person. Its target's leg ends failed, stopped or lost
-- (target_outcome) when the target ran out of time, could not start or was never answered; the handover itself ends
-- failed when Lead's follow-up did. Either way the job did not finish, and both the Conversation's "Handed to" row and the
-- channel's handoff row say so. A Conversation reads the target's outcome from the table (the person already reads the
-- handover's state there), and a channel reads it through channel_handovers, the one way a channel member reads a
-- handover. The outcome is a word, never the target's report or any run id.
grant select (target_outcome) on public.agent_handovers to authenticated;

-- 20270329000000's channel_handovers, now with the target's outcome after the handover's state. The previous app version
-- reads its columns by name and reads none it does not know.
drop function public.channel_handovers(uuid);
create function public.channel_handovers(ch uuid)
returns table(id bigint, message bigint, from_agent uuid, from_name text, from_connection uuid, to_agent uuid, to_name text,
 to_connection uuid, goal text, summary text, reply text, state text, target_outcome text, created_at timestamptz, answered_at timestamptz,
 closed_at timestamptz)
language sql stable security definer set search_path='' as $$
 select h.id,h.channel_message_id,h.from_agent,f.name,f.connection_id,h.to_agent,t.name,t.connection_id,h.goal,h.summary,h.reply,
  h.state,h.target_outcome,h.created_at,h.target_closed_at,h.closed_at
 from public.agent_handovers h
  join public.channel_messages m on m.id=h.channel_message_id
  join public.hermes_agents f on f.id=h.from_agent and f.company_id=h.company_id
  join public.hermes_agents t on t.id=h.to_agent and t.company_id=h.company_id
 where m.channel_id=ch and h.company_id=m.company_id and auth.uid() is not null and public.in_channel(ch)
 order by h.id desc;
$$;
revoke all on function public.channel_handovers(uuid) from public,anon,service_role;
grant execute on function public.channel_handovers(uuid) to authenticated;

-- 2. 20270325000000's answer_channel_start, and an answer without a place is safe on a message of several Runs. The
-- previous app version sends no place, and the Run it meant can no longer be told from its call alone once another Run of
-- the message could have made the same attempt: Runs go one after another, so an earlier Run that closed (answered, or
-- given up) has attempts of its own, and its late answer would otherwise land on the next Run. Such a call then changes
-- nothing:
--  - a refusal (no run id) when another Run of the message reached that attempt, so a late refusal of the first Run's
--    first attempt never fails the second Run, which retries its start as any Run whose answer did not come;
--  - a run id when another Run of the message reached that attempt and closed without one, so a late start of a Run that
--    was given up is never recorded on the next Run. A Run that recorded its run id keeps it for every attempt (one
--    idempotency key per Run, lib/channel-runs.mjs), so its late answer is matched by that id first and never reaches here.
-- A message of one Run, or a Run whose earlier Runs never attempted a start, keeps the rule it had. A call naming its place
-- is unchanged.
create or replace function public.answer_channel_start(message bigint, attempt integer, run text, ordinal smallint default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs;
begin
 if run is not null then
  select * into r from public.channel_runs where message_id=message and run_id=run for update;
  if found then return r.outcome is null; end if;
 end if;
 if ordinal is not null then
  select * into r from public.channel_runs where message_id=message and public.channel_runs.ordinal=answer_channel_start.ordinal for update;
  if r.message_id is null or r.outcome is not null or r.attempts is distinct from attempt then return false; end if;
  if run is not null then
   if r.run_id is not null then return r.run_id=run; end if;
   update public.channel_runs set run_id=run where message_id=message and public.channel_runs.ordinal=r.ordinal; return true;
  end if;
  if attempt = 1 and r.attempts = 1 then
   return public.close_channel_run(message, null, 'failed', null, null, null);
  end if;
  return false;
 end if;
 select * into r from public.channel_runs where message_id=message and outcome is null and run_id is null order by ordinal limit 1 for update;
 if r.message_id is null or r.outcome is not null then return false; end if;
 if exists(select 1 from public.channel_runs o where o.message_id=message and o.ordinal<>r.ordinal and o.attempts>=attempt
   and (run is null or o.run_id is null)) then
  return false;
 end if;
 if run is not null then
  update public.channel_runs set run_id=run where message_id=message and public.channel_runs.ordinal=r.ordinal; return true;
 end if;
 -- A refused first start ends the Run only while no later attempt was made: only a first start can prove nothing started.
 if attempt = 1 and r.attempts = 1 then
  return public.close_channel_run(message, null, 'failed', null, null, null);
 end if;
 return false;
end $$;
revoke all on function public.answer_channel_start(bigint,integer,text,smallint) from public,anon,authenticated;
grant execute on function public.answer_channel_start(bigint,integer,text,smallint) to service_role;
