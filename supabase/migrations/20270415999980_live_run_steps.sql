-- While an Agent works, its reader sees each step live (#646): the app reads the open Run's tool calls from the Engine's
-- own event stream and passes them on, keeping none of them (ADR 0017). These two say which Run that is, and on which
-- profile, to the person who reads the place it works in, and to nobody else.

-- A Conversation's: the Run its own person's chat waits on now (conversation_open_run), for that person while they
-- still see its Agent, as the chat itself is read (conversations_read). A job command's Run is no Run of the chat's
-- Agent, so it has none.
create function public.conversation_live_run(conversation uuid) returns table(run text, profile text)
language sql stable security definer set search_path='' as $$
 select o.run,a.profile from public.conversations cv
  join public.hermes_agents a on a.id=cv.agent_id and a.company_id=cv.company_id
  cross join lateral public.conversation_open_run(cv.id) o
 where cv.id=conversation and auth.uid() is not null and cv.person_id=auth.uid()
  and public.is_member(cv.company_id) and public.can_see_agent(cv.company_id,cv.agent_id)
  and o.run is not null and a.profile is not null;
$$;
revoke all on function public.conversation_live_run(uuid) from public,anon,service_role;
grant execute on function public.conversation_live_run(uuid) to authenticated;

-- A channel's: the Run being worked on now, the lowest open place of the oldest message with one, as the channel shows
-- its Agent working (lib/channels.ts), for a reader in the channel who may call that Agent there. A Run whose start has
-- not reached the Engine yet has none.
create function public.channel_live_run(ch uuid) returns table(run text, profile text)
language sql stable security definer set search_path='' as $$
 with first as (
  select r.run_id,r.profile,r.agent_id from public.channel_runs r
  where r.channel_id=ch and r.outcome is null
  order by r.message_id,coalesce(r.ordinal,1) limit 1)
 select f.run_id,f.profile from first f
 where auth.uid() is not null and public.in_channel(ch) and f.run_id is not null and f.profile is not null
  and f.agent_id is not null and public.channel_agent(ch,auth.uid(),f.agent_id);
$$;
revoke all on function public.channel_live_run(uuid) from public,anon,service_role;
grant execute on function public.channel_live_run(uuid) to authenticated;
