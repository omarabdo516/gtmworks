-- #428: a channel Run, or a leg of a handover, that failed because its Company's Engine has no model provider at all
-- ends as `no_model`, as a Conversation's Run does since #422. The channel then says the Company has no model connected
-- (an Owner gets the link to Subscription and models, a Member is told to ask the Owner) instead of "couldn't reply",
-- and a handover in a Conversation closes the person's Run as `no_model`, which that chat already reads. It is a
-- failure like any other everywhere else: every check that a Run or a leg ended reads `outcome is not null`.
--
-- The previous app version runs against this: it sends `failed` as before, and channel_handovers answers it one column
-- more, which it does not read.
alter table public.channel_runs drop constraint channel_runs_outcome_check;
alter table public.channel_runs add constraint channel_runs_outcome_check
 check (outcome in ('completed','failed','no_model','stopped','lost'));
alter table public.agent_handovers drop constraint agent_handovers_target_outcome;
alter table public.agent_handovers add constraint agent_handovers_target_outcome
 check (target_outcome in ('completed','failed','no_model','stopped','lost'));
alter table public.agent_handovers drop constraint agent_handovers_follow_up_outcome;
alter table public.agent_handovers add constraint agent_handovers_follow_up_outcome
 check (follow_up_outcome in ('completed','failed','no_model','stopped','lost'));

-- 20270325000000's close_channel_run, unchanged but for the outcome it takes.
create or replace function public.close_channel_run(message bigint, run text, run_outcome text, reply text, used_input bigint, used_output bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.channel_runs;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','no_model','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(reply),'') <> '') then
  raise exception 'channelFailed' using errcode='22023'; end if;
 if run is null then
  select * into r from public.channel_runs where message_id=message and outcome is null order by ordinal limit 1 for no key update;
 else
  select * into r from public.channel_runs where message_id=message and outcome is null and run_id=run for no key update;
 end if;
 if r.message_id is null then return false; end if;
 update public.channel_runs set outcome=run_outcome, closed_at=now()
  where message_id=message and ordinal=r.ordinal;
 if run_outcome='completed' then
  insert into public.channel_messages(company_id, channel_id, author, agent_id, author_name, body, reply_to, reply_ordinal)
   values (r.company_id, r.channel_id, 'agent', r.agent_id, r.agent_name, left(reply, 200000), message, r.ordinal)
   on conflict (reply_to, reply_ordinal) do nothing;
 end if;
 return true;
end $$;
revoke all on function public.close_channel_run(bigint,text,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.close_channel_run(bigint,text,text,text,bigint,bigint) to service_role;

-- 20270413000000's close_handover_target, unchanged but for the outcome it takes: a command's job that ended no_model
-- closes the person's Run as no_model, so that chat says the Company has no model connected.
create or replace function public.close_handover_target(h bigint, run text, run_outcome text, words text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers; target public.hermes_agents;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','no_model','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(words),'') <> '')
  then raise exception 'handoverFailed' using errcode='22023'; end if;
 update public.agent_handovers set state=case when answers_person then 'done' else 'returning' end, target_outcome=run_outcome,
  summary=case when run_outcome='completed' then left(btrim(words),8000) end, target_closed_at=now(), attempted_at=null,
  return_started_at=case when answers_person then null else now() end,
  closed_at=case when answers_person then now() end
  where id=h and state='target' and target_run=run and target_outcome is null
  returning * into r;
 if r.id is not null and r.answers_person and r.conversation_id is not null then
  insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
   values(r.company_id,r.conversation_id,r.run_id,run_outcome) on conflict do nothing;
  if run_outcome='completed' then
   select * into target from public.hermes_agents where id=r.to_agent;
   insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
    values(r.company_id,r.conversation_id,'agent',target.id,coalesce(target.name,''),left(words,200000),run) on conflict do nothing;
  end if;
 end if;
 if r.id is not null and run_outcome='completed' and r.channel_message_id is not null then
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
   select r.company_id,r.to_agent,'agent',t.name,'card',w.id,r.to_agent,'channel_reply','{}'::jsonb,
    'channel_handover_replies',r.id,now()
   from public.hermes_agents t
   join public.work_cards w on w.company_id=r.company_id
    and w.channel_id=(select m.channel_id from public.channel_messages m where m.id=r.channel_message_id)
   where t.id=r.to_agent
   on conflict (source,source_id) do nothing;
 end if;
 return r.id is not null;
end $$;
revoke all on function public.close_handover_target(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.close_handover_target(bigint,text,text,text) to service_role;

-- 20270329000000's close_handover_follow_up, unchanged but for the outcome it takes: Lead's follow-up that ended no_model
-- closes the person's Run as no_model.
create or replace function public.close_handover_follow_up(h bigint, run text, run_outcome text, reply text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers; existing public.conversations;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','no_model','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(reply),'') <> '')
  then raise exception 'handoverFailed' using errcode='22023'; end if;
 select * into r from public.agent_handovers where id=h for update;
 if r.id is null or r.state<>'follow_up' or r.follow_up_run is distinct from run then return false; end if;
 if r.conversation_id is not null then
  select * into existing from public.conversations where id=r.conversation_id;
  insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
   values(existing.company_id,r.conversation_id,run,run_outcome) on conflict do nothing;
  if run_outcome='completed' then
   insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
    values(existing.company_id,r.conversation_id,'agent',existing.agent_id,existing.agent_name,left(reply,200000),run)
    on conflict do nothing;
  end if;
 end if;
 update public.agent_handovers set state='done', follow_up_outcome=run_outcome,
  reply=case when r.conversation_id is null and run_outcome='completed' then left(btrim(close_handover_follow_up.reply),200000) end,
  closed_at=now() where id=h;
 return true;
end $$;
revoke all on function public.close_handover_follow_up(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.close_handover_follow_up(bigint,text,text,text) to service_role;

-- 20270415600000's channel_handovers (with the target's outcome, #375), and `no_model` after its last column: the handover ended with no reply from Lead, and the leg that ended
-- it (Lead's follow-up, or the target's when no follow-up ran) ended for want of any model provider, so the channel draws
-- the no-model line under its row where that reply would be. Its return type changes, so it is made again.
drop function public.channel_handovers(uuid);
create function public.channel_handovers(ch uuid)
returns table(id bigint, message bigint, from_agent uuid, from_name text, from_connection uuid, to_agent uuid, to_name text,
 to_connection uuid, goal text, summary text, reply text, state text, target_outcome text, created_at timestamptz, answered_at timestamptz,
 closed_at timestamptz, no_model boolean)
language sql stable security definer set search_path='' as $$
 select h.id,h.channel_message_id,h.from_agent,f.name,f.connection_id,h.to_agent,t.name,t.connection_id,h.goal,h.summary,h.reply,
  h.state,h.target_outcome,h.created_at,h.target_closed_at,h.closed_at,
  h.state in ('done','failed') and h.reply is null and coalesce(coalesce(h.follow_up_outcome,h.target_outcome)='no_model',false)
 from public.agent_handovers h
  join public.channel_messages m on m.id=h.channel_message_id
  join public.hermes_agents f on f.id=h.from_agent and f.company_id=h.company_id
  join public.hermes_agents t on t.id=h.to_agent and t.company_id=h.company_id
 where m.channel_id=ch and h.company_id=m.company_id and auth.uid() is not null and public.in_channel(ch)
 order by h.id desc;
$$;
revoke all on function public.channel_handovers(uuid) from public,anon,service_role;
grant execute on function public.channel_handovers(uuid) to authenticated;
