-- #765 (spec #759, ADR 0029): a Channel's message is stored first too, and the Runs of the Agents it calls start after
-- it, kicked by the request once its answer has gone (lib/channel-runs.mjs postChannelMessage, the route's after()).
-- A Run whose start the Engine refused, or that was not reached within the attempts, ends failed with no Run named:
-- its reader sees "not sent" for that Agent, and the message's own person may try it again, which makes no second message.
--
-- Additive (ADR 0023): one generated column readers may select, and one function. The previous release reads the
-- columns it always read and calls nothing new.

-- Whether the Engine named a Run for this Agent's turn: a failed turn that never started is "not sent".
alter table public.channel_runs add column started boolean generated always as (run_id is not null) stored;
grant select (started) on public.channel_runs to authenticated;

-- "Try again" on an Agent's turn that was not sent: the message's own person, while they may write in its Company,
-- puts that turn back to never started, so the next drive starts it as a first attempt. Answers whether it waits again.
create function public.retry_channel_run(ch uuid, message bigint, ordinal smallint) returns boolean
language plpgsql security definer set search_path='' as $$
declare retried integer; k public.channels;
begin
 select * into k from public.channels where id=ch;
 if k.id is null or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.conversation_can_write(k.company_id) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if not exists(select 1 from public.channel_messages m where m.id=message and m.channel_id=ch and m.author='person' and m.person_id=auth.uid()) then
  raise exception 'channelNotFound' using errcode='P0002';
 end if;
 update public.channel_runs r set outcome=null, closed_at=null, attempts=0, attempted_at=null
  where r.message_id=message and r.channel_id=ch and r.ordinal=retry_channel_run.ordinal and r.outcome='failed' and r.run_id is null;
 get diagnostics retried=row_count;
 return retried>0;
end $$;
revoke all on function public.retry_channel_run(uuid,bigint,smallint) from public,anon,service_role;
grant execute on function public.retry_channel_run(uuid,bigint,smallint) to authenticated;
