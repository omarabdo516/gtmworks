-- One module answers "the Engine of this Company" (#379, ADR 0018): every Hermes call the app and the worker make names
-- the Company it serves, so the module can answer from that Company's Engine. The Runs these four functions list are
-- read and closed on the Engine of the Company the Run belongs to, so each due row names its Company beside the profile
-- it was pinned to. Nothing these functions decide changes, and their grants are kept.

drop function public.open_conversation_runs(uuid,uuid,bigint);
create function public.open_conversation_runs(just uuid default null, owner uuid default null, after bigint default 0)
 returns table(message bigint, conversation uuid, run text, person uuid, profile text, company uuid) language sql stable security definer set search_path='' as $function$
 select m.id,m.conversation_id,m.run_id,c.person_id,a.profile,c.company_id from public.conversation_messages m
 join public.conversations c on c.id=m.conversation_id left join public.hermes_agents a on a.id=c.agent_id and a.company_id=c.company_id
 where m.author='person' and m.id>after and (just is null or m.conversation_id=just) and (owner is null or c.person_id=owner)
  and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
  and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)
 order by m.id limit 500;
$function$;
revoke all on function public.open_conversation_runs(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.open_conversation_runs(uuid,uuid,bigint) to service_role;

drop function public.channel_runs_due(uuid,bigint,bigint);
create function public.channel_runs_due(just_channel uuid default null, just_message bigint default null, after bigint default 0)
 returns table(message bigint, run text, profile text, ordinal smallint, company uuid)
 language sql stable security definer set search_path='' as $function$
 select r.message_id, r.run_id, r.profile, r.ordinal, r.company_id from public.channel_runs r
 where r.outcome is null and r.message_id > coalesce(after, 0)
  and (just_channel is null or r.channel_id=just_channel) and (just_message is null or r.message_id=just_message)
  and (r.run_id is not null or r.message_id=just_message or (r.ordinal > 1 and r.attempts = 0)
   or (r.attempts = 0 and r.created_at < now()-interval '1 minute') or (r.attempts > 0 and r.attempted_at < now()-interval '30 seconds'))
  and not exists(select 1 from public.channel_runs e where e.message_id=r.message_id and e.ordinal<r.ordinal and e.outcome is null)
 order by r.message_id, r.ordinal limit 500;
$function$;
revoke all on function public.channel_runs_due(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.channel_runs_due(uuid,bigint,bigint) to service_role;

drop function public.note_runs_due(bigint,bigint);
create function public.note_runs_due(just_message bigint default null, after bigint default 0)
 returns table(message bigint, run text, profile text, company uuid) language sql stable security definer set search_path='' as $function$
 select r.note_id, r.run_id, r.profile, r.company_id from public.note_runs r
 where r.outcome is null and r.note_id > coalesce(after, 0) and (just_message is null or r.note_id=just_message)
  and (r.run_id is not null or r.note_id=just_message
   or (r.attempts = 0 and r.created_at < now()-interval '1 minute') or (r.attempts > 0 and r.attempted_at < now()-interval '30 seconds'))
 order by r.note_id limit 500;
$function$;
revoke all on function public.note_runs_due(bigint,bigint) from public,anon,authenticated;
grant execute on function public.note_runs_due(bigint,bigint) to service_role;

drop function public.handovers_due(uuid,bigint,uuid);
create function public.handovers_due(just_conversation uuid default null, after bigint default 0, just_channel uuid default null)
 returns table(id bigint, state text, conversation uuid, run text, profile text, attempt integer, company uuid)
 language sql stable security definer set search_path='' as $$
 select h.id, h.state, h.conversation_id,
  case h.state when 'target' then h.target_run when 'follow_up' then h.follow_up_run end,
  case h.state
   when 'target' then (select a.profile from public.hermes_agents a where a.id=h.to_agent)
   when 'follow_up' then (select a.profile from public.hermes_agents a where a.id=h.from_agent)
   else null end,
  case h.state when 'returning' then h.return_attempts else h.target_attempts end,
  h.company_id
 from public.agent_handovers h
 where h.state not in ('done','failed') and h.id > coalesce(after,0)
  and (just_conversation is null or h.conversation_id=just_conversation)
  and (just_channel is null or exists(select 1 from public.channel_messages m where m.id=h.channel_message_id and m.channel_id=just_channel))
  and (h.state in ('target','follow_up') or h.attempted_at is null or h.attempted_at < now()-interval '30 seconds')
 order by h.id limit 500;
$$;
revoke all on function public.handovers_due(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.handovers_due(uuid,bigint,uuid) to service_role;
