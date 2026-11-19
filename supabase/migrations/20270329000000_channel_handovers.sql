-- #150: Lead hands work over inside a channel too (decision 0043: only the main Agent gives work to another Agent),
-- rebuilt on #317's record rather than on the Engine's helper events. A `hand_to_agent` call in the main Agent's channel
-- Run is kept against the channel message whose Run made it (channel_hand_to_agent), and lib/handovers.mjs then runs the
-- job on the target's own profile in that Agent's session of the channel, and brings Lead back with a follow-up Run in
-- Lead's own session. Only the channel's own Agents are ever targets, whoever the model names.
--
-- Additive only: `agent_handovers` keeps a Conversation's link or a channel message's, never both, as reply_cards does;
-- two columns keep what the target reported and Lead's reply for the channel to draw, the channel's record reads them
-- through one function (channel_handovers) and never from the table, which keeps no channel read policy, and the log's
-- channel branch reads the handover's row. Every function is redefined from its latest definition. The previous app version runs against this: its own handovers carry no channel link, its pinned
-- channel Runs hold no hand_to_agent, and the functions it calls are unchanged.

-- A handover keeps a Conversation's link or a channel message's, never both, and the same run and call keep one handover
-- either way. The existing unique (conversation_id,run_id,call_id) no longer covers a channel row, whose conversation_id
-- is null.
alter table public.agent_handovers alter column conversation_id drop not null;
alter table public.agent_handovers add column channel_message_id bigint references public.channel_messages(id) on delete cascade;
alter table public.agent_handovers add constraint agent_handovers_one_place check ((conversation_id is null)<>(channel_message_id is null));
create unique index agent_handovers_channel_call on public.agent_handovers(channel_message_id,run_id,call_id);

-- When the target's Run ended (a channel draws its answer there), and Lead's follow-up reply, which a channel draws in
-- the chat as people saw it. A Conversation's follow-up still writes its own message and keeps neither.
alter table public.agent_handovers add column target_closed_at timestamptz;
alter table public.agent_handovers add column reply text constraint agent_handovers_reply check (reply is null or length(reply) between 1 and 200000);
alter table public.agent_handovers add constraint agent_handovers_reply_only_reported check (reply is null or follow_up_outcome='completed');

-- A channel handover's answer on its Card (#151) is a log row of its own, kept against the handover, so its source is
-- its own; every other source stays as it was.
alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in
 ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit','note_runs','reply_cards',
  'member_invitations','reply_card_answers','channel_permissions','agent_handovers','channel_handover_replies'));

-- A channel's handover is read through channel_handovers below and never from the table: the table keeps no channel
-- read policy and no channel_message_id grant, so a channel's member reads no row of it (and so Lead's Engine run id,
-- run_id, which no person may name). Its message link stays the worker's own column.

-- Whether a handover was made in a channel, read without the reader's own row-level security: a log row's policy asks it
-- about a handover the reader may not see, and it answers only that the handover is a channel's, never which.
create function public.handover_in_channel(h bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agent_handovers x where x.id=h and x.channel_message_id is not null);
$$;
revoke all on function public.handover_in_channel(bigint) from public,anon,service_role;
grant execute on function public.handover_in_channel(bigint) to authenticated;

-- Whether a handover belongs to a channel the caller is in, read without the reader's own row-level security: the log's
-- channel branches ask it, since no person reads a channel handover from the table itself.
create function public.handover_in_my_channel(h bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agent_handovers x join public.channel_messages m on m.id=x.channel_message_id
  where x.id=h and auth.uid() is not null and public.in_channel(m.channel_id));
$$;
revoke all on function public.handover_in_my_channel(bigint) from public,anon,service_role;
grant execute on function public.handover_in_my_channel(bigint) to authenticated;

-- Who may hand work over in a channel: a Member of it who may write there (never a Viewer), talking to the Company's
-- Lead, which must be an Agent of that channel. No other Agent hands on (decision 0043).
create function public.channel_can_hand_over(ch uuid, person uuid, agent uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.channel_agent(ch,person,agent)
  and exists(select 1 from public.channels k join public.members m on m.company_id=k.company_id
   where k.id=ch and m.person_id=person and m.removed_at is null and m.role<>'viewer'
    and public.is_company_lead(k.company_id,agent));
$$;
revoke all on function public.channel_can_hand_over(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- The other Agents of a channel message's channel that its Run may hand work to, as the names the tool may be given:
-- none when that Run's Agent may not hand over there. The list is the pinned tool's own enum (lib/channel-runs.mjs), so
-- the Run that is started is told the channel's Agents and no Agent outside it.
create function public.channel_handover_agents(message bigint) returns text[]
language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(a.name order by a.name),'{}')
 from public.channel_runs r
  join public.channel_messages m on m.id=r.message_id
  join public.channels k on k.id=m.channel_id
  join public.hermes_agents a on a.company_id=k.company_id
 where r.message_id=channel_handover_agents.message and m.author='person' and a.id<>r.agent_id and a.profile is not null
  and public.channel_can_hand_over(m.channel_id,m.person_id,r.agent_id)
  and public.channel_agent(m.channel_id,m.person_id,a.id);
$$;
revoke all on function public.channel_handover_agents(bigint) from public,anon,authenticated;
grant execute on function public.channel_handover_agents(bigint) to service_role;

-- 20270327000000's pin_channel_run, with the handover after the handed step: a channel Run of the Agent that may hand
-- over is offered hand_to_agent too, and only when it was given its text (the channel's Agents as its enum).
create or replace function public.pin_channel_run(message bigint, specs jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs; m public.channel_messages; offered text[];
begin
 select * into r from public.channel_runs where message_id=message and outcome is null order by ordinal limit 1 for update;
 if r.message_id is null or r.outcome is not null then return null; end if;
 if r.tools is null then
  select * into m from public.channel_messages where id=message;
  if m.id is null or m.author<>'person' then return null; end if;
  if public.channel_can_show_cards(r.channel_id,m.person_id,r.agent_id) then
   offered:=array(select t from unnest(array['show_draft','show_review','hand_over']) t where jsonb_typeof(specs->t)='string');
   if public.channel_can_hand_over(r.channel_id,m.person_id,r.agent_id) and jsonb_typeof(specs->'hand_to_agent')='string' then
    offered:=array_append(offered,'hand_to_agent'); end if;
   update public.channel_runs set tools=case when cardinality(offered)>0 then
     '['||(select string_agg(specs->>t,',' order by o) from unnest(offered) with ordinality u(t,o))||']' end
    where message_id=message and ordinal=r.ordinal returning * into r;
  end if;
 end if;
 return jsonb_build_object('tools',r.tools);
end $$;
revoke all on function public.pin_channel_run(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.pin_channel_run(bigint,jsonb) to service_role;

-- The handover the main Agent's channel Run keeps, once per message, run and call. `agent_name` is the name the team
-- knows: only an Agent of the same channel, on a profile of its own or the Company's, is a target, and the call itself
-- must come from the channel's Lead on a message of that channel. Anything else is ignored, so a reply whose target does
-- not exist still closes its Run (lib/agent-tools.mjs). Its log row is written once, and the channel's members read it.
create function public.channel_hand_to_agent(message bigint, run text, call text, agent_name text, goal text, context text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.channel_messages; r public.channel_runs; target public.hermes_agents; handed public.agent_handovers; asker text; card bigint;
begin
 select * into m from public.channel_messages where id=message;
 select * into r from public.channel_runs where message_id=message and run_id=run;
 if m.id is null or m.author<>'person' or r.message_id is null or r.agent_id is null
  or not public.channel_can_hand_over(m.channel_id,m.person_id,r.agent_id)
  then return jsonb_build_object('state','refused'); end if;
 if coalesce(agent_name,'')='' or coalesce(goal,'')='' then return jsonb_build_object('state','ignored'); end if;
 select * into target from public.hermes_agents a
  where a.company_id=r.company_id and a.id<>r.agent_id and a.profile is not null
   and lower(btrim(a.name))=lower(btrim(agent_name)) and public.channel_agent(m.channel_id,m.person_id,a.id)
  order by a.id limit 1;
 if not found then return jsonb_build_object('state','ignored'); end if;
 insert into public.agent_handovers(company_id,channel_message_id,run_id,call_id,from_agent,to_agent,goal,context)
  values(r.company_id,message,run,call,r.agent_id,target.id,btrim(goal),nullif(btrim(coalesce(context,'')),''))
  on conflict (channel_message_id,run_id,call_id) do nothing returning * into handed;
 if handed.id is not null then
  select name into asker from public.hermes_agents where id=r.agent_id;
  -- #150/#151: the channel's Card, when it has one, carries the row, so its Log shows "handed to <Agent>" and its
  -- "Worked on it:" lists the Agent handed the work.
  select w.id into card from public.work_cards w where w.company_id=r.company_id and w.channel_id=m.channel_id;
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
   values(r.company_id,r.agent_id,'agent',asker,case when card is null then 'agent' else 'card' end,card,target.id,'agent_handed_to',
    jsonb_build_object('agent_name',asker,'to_name',target.name,'goal',handed.goal),'agent_handovers',handed.id,handed.created_at)
   on conflict (source,source_id) do nothing;
 end if;
 return jsonb_build_object('state','created','agent',target.name);
end $$;
revoke all on function public.channel_hand_to_agent(bigint,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.channel_hand_to_agent(bigint,text,text,text,text,text) to service_role;

-- 20270320000000's handovers_due, and a channel's pass asks for its own handovers only. A channel handover names its
-- channel message, and its follow-up Run is the Agent that handed the work over.
drop function public.handovers_due(uuid,bigint);
create function public.handovers_due(just_conversation uuid default null, after bigint default 0, just_channel uuid default null)
 returns table(id bigint, state text, conversation uuid, run text, profile text, attempt integer)
 language sql stable security definer set search_path='' as $$
 select h.id, h.state, h.conversation_id,
  case h.state when 'target' then h.target_run when 'follow_up' then h.follow_up_run end,
  case h.state
   when 'target' then (select a.profile from public.hermes_agents a where a.id=h.to_agent)
   when 'follow_up' then (select a.profile from public.hermes_agents a where a.id=h.from_agent)
   else null end,
  case h.state when 'returning' then h.return_attempts else h.target_attempts end
 from public.agent_handovers h
 where h.state not in ('done','failed') and h.id > coalesce(after,0)
  and (just_conversation is null or h.conversation_id=just_conversation)
  and (just_channel is null or exists(select 1 from public.channel_messages m where m.id=h.channel_message_id and m.channel_id=just_channel))
  and (h.state in ('target','follow_up') or h.attempted_at is null or h.attempted_at < now()-interval '30 seconds')
 order by h.id limit 500;
$$;
revoke all on function public.handovers_due(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.handovers_due(uuid,bigint,uuid) to service_role;

-- 20270320000000's begin_handover, with the channel's leg: the target works in the session it has in that channel, and
-- Lead's follow-up in Lead's own, so a channel's memory follows each Agent. A channel's job names the channel and the
-- team Lead reports to; a Conversation's is worded as before. The pinned Engine cannot switch the target's toolsets for
-- its Run, so the target's own profile keeps Hermes's memory and cronjob tools: its input says plainly not to save
-- anything to memory, not to schedule anything and not to hand the job on.
create or replace function public.begin_handover(h bigint)
 returns table(state text, attempt integer, company uuid, profile text, session uuid, input text, instructions text)
 language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers; talk public.conversations; chan uuid; target public.hermes_agents; lead public.hermes_agents; asking text; began timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.agent_handovers where id=h for update;
 if r.id is null or r.state not in ('waiting','returning') then return; end if;
 if r.attempted_at is not null and r.attempted_at > now()-interval '30 seconds' then return; end if;
 select * into target from public.hermes_agents where id=r.to_agent;
 if r.conversation_id is not null then
  select * into talk from public.conversations where id=r.conversation_id;
  select * into lead from public.hermes_agents where id=talk.agent_id and talk.company_id=r.company_id;
 else
  select m.channel_id into chan from public.channel_messages m where m.id=r.channel_message_id;
  select * into lead from public.hermes_agents where id=r.from_agent and r.company_id=r.company_id;
 end if;

 if r.state='waiting' then
  if r.target_attempts=0 and r.created_at < now()-interval '10 minutes'
   or r.target_attempts>0 and r.created_at < now()-interval '1 day' then
   update public.agent_handovers set state='returning', target_outcome='failed', attempted_at=null, return_started_at=now() where id=h; return; end if;
  if target.id is null or target.profile is null then
   update public.agent_handovers set state='returning', target_outcome='failed', attempted_at=null, return_started_at=now() where id=h; return; end if;
  -- ADR 0014: a Company profile serves its own Company, and no Run starts while its tools are pending. Waits.
  if target.profile ~ '^co-[0-9a-f]{32}$'
   and (target.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
  -- ADR 0016: an Agent profile serves its own Agent, on the same terms. Waits.
  if public.agent_profile_refusal(target.profile,r.company_id,target.id) is not null then return; end if;
  update public.agent_handovers set target_attempts=target_attempts+1, attempted_at=now() where id=h returning target_attempts into r.target_attempts;
  if r.conversation_id is not null then
   asking := 'Lead in the team is handing you a job in one of the team''s chats.'
    || E'\n\nThe job:\n' || r.goal
    || coalesce(E'\n\nWhat Lead knows about the job:\n' || r.context,'')
    || E'\n\nDo the job now. Reply with your result for Lead: what you did, what you found and anything Lead must tell the person. Do not ask anyone a question: nobody but Lead reads this chat.'
    || E'\n\nDo not save anything to memory, do not schedule anything, and do not hand the job on.';
  else
   asking := 'Lead in the team is handing you a job in this channel.'
    || E'\n\nThe job:\n' || r.goal
    || coalesce(E'\n\nWhat Lead knows about the job:\n' || r.context,'')
    || E'\n\nDo the job now. Reply with your result for Lead: what you did, what you found and anything Lead must tell the team. Do not ask anyone a question: your reply is what Lead reports, so write the result, not a question.'
    || E'\n\nDo not save anything to memory, do not schedule anything, and do not hand the job on.';
  end if;
  -- The target works in a session of its own for this chat (its own in the channel), never Lead's: an Agent on the
  -- Company's profile shares Lead's profile, and Lead's session holds only what Lead was told.
  return query select 'waiting'::text, r.target_attempts, r.company_id, target.profile,
   case when r.conversation_id is not null then md5(r.conversation_id::text||':'||r.to_agent::text)::uuid
    else md5(chan::text||':'||r.to_agent::text)::uuid end,
   asking, target.instructions;
  return;
 end if;

 -- The follow-up leg is given up a day after it began (#354): a start whose answer was lost keeps being asked for within
 -- that window, and after it the leg closes as failed, so the person still learns the job did not reach them. A leg that
 -- began before this column did starts its window now.
 if r.return_started_at is null then
  update public.agent_handovers set return_started_at=now() where id=h returning return_started_at into began;
  r.return_started_at:=began; end if;
 if r.return_started_at < now()-interval '1 day' then
  update public.agent_handovers set state='failed', closed_at=now() where id=h; return; end if;
 if lead.id is null or lead.profile is null then
  update public.agent_handovers set state='failed', closed_at=now() where id=h; return; end if;
 if lead.profile ~ '^co-[0-9a-f]{32}$'
  and (lead.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 if public.agent_profile_refusal(lead.profile,r.company_id,lead.id) is not null then return; end if;
 update public.agent_handovers set return_attempts=return_attempts+1, attempted_at=now() where id=h returning return_attempts into r.return_attempts;
 if r.target_outcome='completed' then
  asking := 'You handed this job to ' || target.name || case when r.conversation_id is null then ' in this channel' else ' in this conversation' end || ', and it has finished.'
   || E'\n\nThe job:\n' || r.goal
   || E'\n\nWhat ' || target.name || ' reported:\n' || coalesce(r.summary,'')
   || case when r.conversation_id is null
     then E'\n\nWrite your reply to the team now, in their language: what came of the job, and what they should know. Write only the reply.'
     else E'\n\nWrite your reply to the person now, in their language: what came of the job, and what they should know. Write only the reply.' end;
 else
  asking := 'You handed this job to ' || target.name || case when r.conversation_id is null then ' in this channel' else ' in this conversation' end || ', and it did not finish: it '
   || case coalesce(r.target_outcome,'failed') when 'stopped' then 'was stopped' when 'lost' then 'could not be found' else 'failed' end
   || ' before reporting anything.'
   || E'\n\nThe job:\n' || r.goal
   || case when r.conversation_id is null
     then E'\n\nWrite your reply to the team now, in their language: say the job did not finish, and what you suggest. Write only the reply.'
     else E'\n\nWrite your reply to the person now, in their language: say the job did not finish, and what you suggest. Write only the reply.' end;
 end if;
 return query select 'returning'::text, r.return_attempts, r.company_id, lead.profile,
  case when r.conversation_id is not null then r.conversation_id else md5(chan::text||':'||r.from_agent::text)::uuid end,
  asking, lead.instructions;
end $$;
revoke all on function public.begin_handover(bigint) from public,anon,authenticated;
grant execute on function public.begin_handover(bigint) to service_role;

-- 20270320000000's close_handover_target, keeping when the target's answer came in: a channel draws it there.
create or replace function public.close_handover_target(h bigint, run text, run_outcome text, words text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(words),'') <> '')
  then raise exception 'handoverFailed' using errcode='22023'; end if;
 update public.agent_handovers set state='returning', target_outcome=run_outcome,
  summary=case when run_outcome='completed' then left(btrim(words),8000) end, target_closed_at=now(), attempted_at=null,
  return_started_at=now()
  where id=h and state='target' and target_run=run and target_outcome is null
  returning * into r;
 -- #150/#151: a channel's Card logs the handed-to Agent's answer as a reply in that channel is logged, so its Log draws it
 -- and its "Worked on it:" keeps the Agent. A channel with no Card, or a target that did not report, logs nothing.
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

-- 20270320000000's close_handover_follow_up. A Conversation's reply is its message, the record people saw; a channel's
-- reply is kept on the handover itself, and the channel's record draws it as Lead's message. It is closed here, not by
-- close_conversation_run, since no person's message started it.
create or replace function public.close_handover_follow_up(h bigint, run text, run_outcome text, reply text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers; existing public.conversations;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(reply),'') <> '')
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

-- What a channel's transcript and its details draw of its handovers, newest first: the two Agents with their faces, the
-- job, what the target reported, Lead's reply and when each came. A Viewer reads them; a Member outside the channel
-- reads none.
create function public.channel_handovers(ch uuid)
returns table(id bigint, message bigint, from_agent uuid, from_name text, from_connection uuid, to_agent uuid, to_name text,
 to_connection uuid, goal text, summary text, reply text, state text, created_at timestamptz, answered_at timestamptz, closed_at timestamptz)
language sql stable security definer set search_path='' as $$
 select h.id,h.channel_message_id,h.from_agent,f.name,f.connection_id,h.to_agent,t.name,t.connection_id,h.goal,h.summary,h.reply,
  h.state,h.created_at,h.target_closed_at,h.closed_at
 from public.agent_handovers h
  join public.channel_messages m on m.id=h.channel_message_id
  join public.hermes_agents f on f.id=h.from_agent and f.company_id=h.company_id
  join public.hermes_agents t on t.id=h.to_agent and t.company_id=h.company_id
 where m.channel_id=ch and h.company_id=m.company_id and auth.uid() is not null and public.in_channel(ch)
 order by h.id desc;
$$;
revoke all on function public.channel_handovers(uuid) from public,anon,service_role;
grant execute on function public.channel_handovers(uuid) to authenticated;

-- 20270327000000's company_log_read, and a handover made in a channel is read by that channel's members alone, also where
-- its Agents are hidden from them elsewhere; a Member of the Company outside the channel reads none, an Owner included.
-- A channel card's row follows its channel too (#354): a Manager who may manage the Company reads no draft or review title
-- from a team channel they are not in, though its Agent is one they see. reply_card_in_channel resolves the card's channel
-- without the reader's own row-level security, which a subquery over reply_cards or channel_messages would not. Every other
-- row keeps the rule it had.
alter policy company_log_read on public.company_log using (
 (public.is_member(company_id) and public.can_see_agent(company_id,agent_id) and public.can_see_agent(company_id,actor_id)
  and not (source='reply_cards' and public.reply_card_in_channel(company_log.source_id))
  and not (source='reply_card_answers' and public.reply_card_in_channel(company_log.source_id))
  and not (source='agent_handovers' and public.handover_in_channel(company_log.source_id))
  and (details->>'private' is null or actor_id=auth.uid() or details->>'teller'=auth.uid()::text
   or case when details->>'private'='owners' then public.is_company_owner(company_id) else public.can_manage_company(company_id) end))
 or (source in ('reply_cards','reply_card_answers') and exists(select 1 from public.reply_cards c join public.channel_messages m on m.id=c.channel_message_id
  where c.id=company_log.source_id and c.company_id=company_log.company_id and public.in_channel(m.channel_id)))
 or (source in ('agent_handovers','channel_handover_replies') and public.handover_in_my_channel(company_log.source_id)));
