-- #477 (spec #474, decision 0057): an Agent that was asked can hand the job on, with no depth limit and no check against
-- an Agent already in the chain (Writer asks Ads, Ads asks Critic; or Ads asks the Writer back), in a Conversation and in
-- a channel. The asked Agent works with all its own tools: the instruction not to save to memory, not to schedule and not
-- to hand on is gone. Its Run is offered hand_to_agent, naming the Company's other Agents, and no tool that shows the
-- person a card; any need from the person goes back in its answer.
--
-- A call made in an asked Agent's Run is kept as a child of the handover that Run serves (parent_id), in the same chat or
-- channel, once per run and call (handover_hand_to_agent). The asked Agent's leg does not close while it has an open
-- child: its handover waits (`handing`) until every child has ended, then the asked Agent gets one more Run in its own
-- handover session with what came back (`answering`), and that Run's reply is its answer, kept as the leg's answer
-- (`summary`) as a target's words were. A top handover then goes on to the asking Agent's follow-up, as before; a child
-- has no follow-up of its own: its answer is its parent's to read, so it is done once its leg ended. A child that failed,
-- was stopped or was lost is named as not finished in its parent's answer Run, at every level.
--
-- `state` now moves 'waiting' -> 'target' -> ('handing' -> 'answering' ->) 'returning' -> 'follow_up' -> 'done' for a top
-- handover, and 'waiting' -> 'target' -> ('handing' -> 'answering' ->) 'returning' -> 'done' for a child.
--
-- Additive only, for the previous app version: new columns are nullable or defaulted, every replaced function keeps its
-- signature, and conversation_handovers, whose answer gains one column, is read by column name. That version starts an
-- asked Agent's Run with no tools, so it makes no child; the functions it calls answer it as before for a handover
-- with none.

alter table public.agent_handovers add column parent_id bigint references public.agent_handovers(id) on delete cascade;
create index agent_handovers_parent on public.agent_handovers(parent_id) where parent_id is not null;
-- The tool text the asked Agent's Run is offered, pinned at its first start so a retry sends the same request: the
-- hand_to_agent spec, or '' for none.
alter table public.agent_handovers add column tools text;
-- The asked Agent's answer Run, once its children ended: its start's attempts and when its leg began (its start is
-- retried within a day of this, then given up as failed, as a follow-up's is).
alter table public.agent_handovers add column answer_run text;
alter table public.agent_handovers add column answer_attempts integer not null default 0 constraint agent_handovers_answer_attempts check (answer_attempts >= 0);
alter table public.agent_handovers add column answer_started_at timestamptz;
alter table public.agent_handovers drop constraint agent_handovers_state;
alter table public.agent_handovers add constraint agent_handovers_state
 check (state in ('waiting','target','handing','answering','returning','follow_up','done','failed'));
alter table public.agent_handovers add constraint agent_handovers_answer_run check (state <> 'answering' or answer_run is not null);
-- A job command (#358) is the person's own, and never a child.
alter table public.agent_handovers add constraint agent_handovers_child_of_a_job check (parent_id is null or not answers_person);
grant select (parent_id) on public.agent_handovers to authenticated;

-- The handover a chain started from: the one the chat's or the channel's own Agent made.
create function public.handover_root(h bigint) returns bigint
language sql stable security definer set search_path='' as $$
 with recursive up(id,parent_id) as (
  select x.id,x.parent_id from public.agent_handovers x where x.id=h
  union all
  select p.id,p.parent_id from public.agent_handovers p join up on p.id=up.parent_id)
 select id from up where parent_id is null limit 1;
$$;
revoke all on function public.handover_root(bigint) from public,anon,authenticated,service_role;

-- Whether the person whose message started a handover's chain may still hand work over there: in a Conversation, a
-- writer of the Company (may_hand_to_agent, the rule that kept the call); in a channel, a member of it who may write
-- there, talking to the Agent of the channel that made the chain's first handover (channel_can_hand_over), since an Agent
-- asked further down may be one outside the channel.
create function public.handover_writer(h bigint) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare r public.agent_handovers; root public.agent_handovers; person uuid; chan uuid;
begin
 select * into r from public.agent_handovers where id=h;
 if r.id is null then return false; end if;
 if r.conversation_id is not null then
  select c.person_id into person from public.conversations c where c.id=r.conversation_id and c.company_id=r.company_id;
  return person is not null and public.may_hand_to_agent(r.company_id,r.from_agent,person);
 end if;
 select * into root from public.agent_handovers where id=public.handover_root(h);
 select m.channel_id,m.person_id into chan,person from public.channel_messages m where m.id=r.channel_message_id and m.company_id=r.company_id;
 return chan is not null and root.id is not null and public.channel_can_hand_over(chan,person,root.from_agent);
end $$;
revoke all on function public.handover_writer(bigint) from public,anon,authenticated,service_role;

-- The asked Agent's tool text, pinned once, before its first start: the text given (built from begin_handover's
-- `targets`), or none. A job command's Agent is
-- offered nothing, as before. Answers the pinned text ('' for none), or null for no such handover.
create function public.pin_handover_tools(h bigint, spec text) returns text
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers;
begin
 select * into r from public.agent_handovers where id=h for update;
 if r.id is null then return null; end if;
 if r.tools is null then
  update public.agent_handovers set tools=case when r.answers_person then '' else coalesce(nullif(btrim(spec),''),'') end
   where id=h returning * into r;
 end if;
 return r.tools;
end $$;
revoke all on function public.pin_handover_tools(bigint,text) from public,anon,authenticated;
grant execute on function public.pin_handover_tools(bigint,text) to service_role;

-- The handover an asked Agent's Run keeps, once per run and call, under the handover that Run serves: same Company, same
-- chat or channel, from the asked Agent to any other Agent of the Company with a profile, an Agent already in the chain
-- included. The call must come from that handover's own open Run while the chain's person may still hand work over;
-- anything else answers as a value, never an error, so the Run still closes. Its log row goes to the place's Card, as the
-- first handover's does.
create function public.handover_hand_to_agent(h bigint, run text, call text, agent_name text, goal text, context text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers; target public.hermes_agents; handed public.agent_handovers; asker text; card bigint; chan uuid;
begin
 select * into r from public.agent_handovers where id=h;
 if r.id is null or r.answers_person or r.state<>'target' or r.target_run is distinct from run or coalesce(call,'')=''
  or not public.handover_writer(h) then return jsonb_build_object('state','refused'); end if;
 if coalesce(agent_name,'')='' or coalesce(goal,'')='' then return jsonb_build_object('state','ignored'); end if;
 select * into target from public.hermes_agents a
  where a.company_id=r.company_id and a.id<>r.to_agent and a.profile is not null
   and lower(btrim(a.name))=lower(btrim(agent_name))
  order by a.id limit 1;
 if not found then return jsonb_build_object('state','ignored'); end if;
 insert into public.agent_handovers(company_id,conversation_id,channel_message_id,parent_id,run_id,call_id,from_agent,to_agent,goal,context)
  values(r.company_id,r.conversation_id,r.channel_message_id,h,run,call,r.to_agent,target.id,left(btrim(goal),500),nullif(left(btrim(coalesce(context,'')),2000),''))
  on conflict do nothing returning * into handed;
 if handed.id is not null then
  select a.name into asker from public.hermes_agents a where a.id=r.to_agent and a.company_id=r.company_id;
  if r.channel_message_id is not null then
   select m.channel_id into chan from public.channel_messages m where m.id=r.channel_message_id;
   select w.id into card from public.work_cards w where w.company_id=r.company_id and w.channel_id=chan;
  else
   select w.id into card from public.work_cards w where w.company_id=r.company_id and w.conversation_id=r.conversation_id;
  end if;
  if card is not null or r.channel_message_id is not null then
   insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
    values(r.company_id,r.to_agent,'agent',asker,case when card is null then 'agent' else 'card' end,card,target.id,'agent_handed_to',
     jsonb_build_object('agent_name',asker,'to_name',target.name,'goal',handed.goal),'agent_handovers',handed.id,handed.created_at)
    on conflict (source,source_id) do nothing;
  end if;
 end if;
 return jsonb_build_object('state','created','agent',target.name);
end $$;
revoke all on function public.handover_hand_to_agent(bigint,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.handover_hand_to_agent(bigint,text,text,text,text,text) to service_role;

-- 20270401000000's handovers_due, with the asked Agent's answer leg: a handover waiting on its children (`handing`) is
-- listed as a leg to start, which begin_handover holds until they ended, and its answer Run (`answering`) is read on the
-- asked Agent's profile.
create or replace function public.handovers_due(just_conversation uuid default null, after bigint default 0, just_channel uuid default null)
 returns table(id bigint, state text, conversation uuid, run text, profile text, attempt integer, company uuid)
 language sql stable security definer set search_path='' as $$
 select h.id, h.state, h.conversation_id,
  case h.state when 'target' then h.target_run when 'answering' then h.answer_run when 'follow_up' then h.follow_up_run end,
  case h.state
   when 'target' then (select a.profile from public.hermes_agents a where a.id=h.to_agent)
   when 'answering' then (select a.profile from public.hermes_agents a where a.id=h.to_agent)
   when 'follow_up' then (select a.profile from public.hermes_agents a where a.id=h.from_agent)
   else null end,
  case h.state when 'returning' then h.return_attempts when 'handing' then h.answer_attempts else h.target_attempts end,
  h.company_id
 from public.agent_handovers h
 where h.state not in ('done','failed') and h.id > coalesce(after,0)
  and (just_conversation is null or h.conversation_id=just_conversation)
  and (just_channel is null or exists(select 1 from public.channel_messages m where m.id=h.channel_message_id and m.channel_id=just_channel))
  and (h.state in ('target','answering','follow_up') or h.attempted_at is null or h.attempted_at < now()-interval '30 seconds')
 order by h.id limit 500;
$$;
revoke all on function public.handovers_due(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.handovers_due(uuid,bigint,uuid) to service_role;

-- 20270415960000's begin_handover, with the chain:
--  - A child whose leg ended (`returning`) is done there and then: no follow-up, its answer is its parent's to read.
--  - The asked Agent's job no longer tells it not to save to memory, not to schedule and not to hand on: it says nobody
--    but the asking Agent reads its chat, so any need from the person goes in its answer.
--  - Its answer leg (`handing`) starts once every child has ended, in the asked Agent's own handover session, with what
--    each child answered or that it did not finish. It shares that session, so it waits as a job's start does, and its
--    lost start holds the session in turn.
--  - Whether the chain's person may still hand work over is handover_writer's, which reads a channel's rule from the
--    chain's first asking Agent: an asked Agent further down may be outside the channel.
--  - Its job's leg answers the Agents its Run may hand work to (`targets`), as the tool names them: every other Agent of
--    the Company that can run, the one that asked it and any other in the chain included, each with its job line, by
--    name; none (null) for a job command's Agent (#358, unchanged) and for every other leg. The return type grows by that
--    column, so the function is made again; the previous app version reads its columns by name.
drop function public.begin_handover(bigint);
create function public.begin_handover(h bigint)
 returns table(state text, attempt integer, company uuid, profile text, session uuid, input text, instructions text, targets jsonb)
 language plpgsql security definer set search_path='' as $function$
declare r public.agent_handovers; talk public.conversations; chan uuid; person uuid; target public.hermes_agents; asking_agent public.hermes_agents; asking text; began timestamptz; job text; asker text; came text; whom text;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.agent_handovers where id=h for update;
 if r.id is null or r.state not in ('waiting','handing','returning') then return; end if;
 -- A child has no follow-up leg: once its own leg ended, the handover it serves reads its answer or its failure.
 if r.state='returning' and r.parent_id is not null then
  update public.agent_handovers set state='done', closed_at=now(), attempted_at=null where id=h; return;
 end if;
 if r.attempted_at is not null and r.attempted_at > now()-interval '30 seconds' then return; end if;
 -- The asked Agent's answer waits for every job it handed on (#477).
 if r.state='handing' and exists(select 1 from public.agent_handovers c where c.parent_id=h and c.state not in ('done','failed')) then return; end if;
 -- A target works in one session per chat (or channel): a second job to the same Agent waits while the first may still
 -- be running — an open Run, or a start whose answer was lost (its attempts above zero, as #354 reads one). Every
 -- handover of that place and Agent is counted, not only a command's, since they share the session: a Conversation's by
 -- its id, a channel's by its channel (the target's session there is the channel's, whatever message made the handover).
 -- The asked Agent's answer leg (#477) runs in that same session, so it waits and holds the same way. The row itself is
 -- left out, so a lost start still retries. A lost start given up since may still be running, so it holds the session
 -- until its window ends (session_held_until). The follow-up leg does not wait: it runs in the asking Agent's session.
 -- A start held here notes when, so its ten minutes count from the moment it could go.
 if r.state in ('waiting','handing') and exists(select 1 from public.agent_handovers o
  where o.id<>h and o.to_agent=r.to_agent
   and (case when r.conversation_id is not null then o.conversation_id=r.conversation_id
     else exists(select 1 from public.channel_messages mine join public.channel_messages theirs on theirs.channel_id=mine.channel_id
      where mine.id=r.channel_message_id and theirs.id=o.channel_message_id) end)
   and (o.state in ('target','answering') or o.state='waiting' and o.target_attempts>0 or o.state='handing' and o.answer_attempts>0
    or o.session_held_until>now())) then
  if r.state='waiting' and r.target_attempts=0 then update public.agent_handovers set start_waited_at=now() where id=h; end if;
  return;
 end if;
 select * into target from public.hermes_agents where id=r.to_agent;
 if r.conversation_id is not null then
  select * into talk from public.conversations where id=r.conversation_id;
  select * into asking_agent from public.hermes_agents where id=talk.agent_id and talk.company_id=r.company_id;
  person := talk.person_id;
 else
  select m.channel_id, m.person_id into chan, person from public.channel_messages m where m.id=r.channel_message_id;
  select * into asking_agent from public.hermes_agents where id=r.from_agent and company_id=r.company_id;
 end if;
 select a.name into asker from public.hermes_agents a where a.id=r.from_agent and a.company_id=r.company_id;
 asker := coalesce(nullif(btrim(asker),''),'Lead');
 whom := case when r.conversation_id is null then 'team' else 'person' end;

 if r.state='waiting' then
  -- Given up (a start that never came within ten minutes, or a lost one within a day), a target that cannot run at all,
  -- a person who may no longer hand work over there (handover_writer: removed, now a Viewer, or out of the channel), or,
  -- for a job command, a target no longer the person's to call (#354): no Run starts. A command's handover ends there,
  -- its target never answering, so the person's own Run ends as failed and the chat says the reply did not come; any
  -- other job goes on to the asking Agent's follow-up, or to its parent's answer, which tells of it.
  -- Both windows count from when the start could go: when the job was made, or the last time another job held it.
  -- A lost start given up here keeps the target's session held until its own window would have ended.
  if (r.target_attempts=0 and coalesce(r.start_waited_at,r.created_at) < now()-interval '10 minutes')
   or (r.target_attempts>0 and coalesce(r.start_waited_at,r.created_at) < now()-interval '1 day')
   or target.id is null or target.profile is null
   or not public.handover_writer(h)
   or (r.answers_person and not public.agent_visible_to(r.company_id, person, target.id)) then
   if r.answers_person then
    update public.agent_handovers set state='failed', target_outcome='failed', attempted_at=null, closed_at=now(),
     session_held_until=case when r.target_attempts>0 then coalesce(r.start_waited_at,r.created_at)+interval '1 day' end where id=h;
    insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
     values(r.company_id,r.conversation_id,r.run_id,'failed') on conflict do nothing;
    return;
   end if;
   update public.agent_handovers set state='returning', target_outcome='failed', attempted_at=null, return_started_at=now(),
    session_held_until=case when r.target_attempts>0 then coalesce(r.start_waited_at,r.created_at)+interval '1 day' end where id=h; return;
  end if;
  -- ADR 0014: a Company profile serves its own Company, and no Run starts while its tools are pending. Waits.
  if target.profile ~ '^co-[0-9a-f]{32}$'
   and (target.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
  -- ADR 0016: an Agent profile serves its own Agent, on the same terms. Waits.
  if public.agent_profile_refusal(target.profile,r.company_id,target.id) is not null then return; end if;
  update public.agent_handovers set target_attempts=target_attempts+1, attempted_at=now() where id=h returning target_attempts into r.target_attempts;
  if r.answers_person then
   -- The job is the person's own message, whole: a brief longer than the row's 500-character label still reaches its
   -- Agent. The command itself is dropped, since it names the job and not the work.
   select btrim(regexp_replace(m.body,'^\s*/\S+\s*','')) into job from public.conversation_messages m
    where m.conversation_id=r.conversation_id and m.run_id=r.run_id and m.author='person' limit 1;
   asking := 'The person in this chat used a command that is your job.'
    || E'\n\nThe job:\n' || coalesce(nullif(job,''),r.goal)
    || E'\n\nDo the job now, and write the reply they read, in the language they wrote in: what you did, what you found and anything they must know. You cannot ask a question or wait for an approval in this chat, so do what you can with what you have and say plainly in your reply anything you could not do. Write only the reply.';
  else
   -- #477: the asked Agent works with all its own tools, and may hand a part of the job on (hand_to_agent). Nobody but
   -- the Agent that asked reads its chat, so a need from the person goes back in its reply, never as a question here.
   asking := asker || ' in the team is handing you a job in '
    || case when r.conversation_id is null then 'this channel.' else 'one of the team''s chats.' end
    || E'\n\nThe job:\n' || r.goal
    || coalesce(E'\n\nWhat ' || asker || E' knows about the job:\n' || r.context,'')
    || E'\n\nDo the job now. Reply with your result for ' || asker || ': what you did, what you found and anything ' || asker || ' must tell the ' || whom || '.'
    || E' Nobody but ' || asker || ' reads this chat, so do not ask anyone a question here: put anything you need from the ' || whom || ' in your reply, and ' || asker || ' will ask them.';
  end if;
  -- The target works in a session of its own for this chat (its own in the channel), never the asking Agent's: an Agent
  -- on the Company's profile shares Lead's profile, and the asking Agent's session holds only what it was told. An Agent
  -- asked again further down a chain works in that same session, never the Conversation's.
  return query select 'waiting'::text, r.target_attempts, r.company_id, target.profile,
   case when r.conversation_id is not null then md5(r.conversation_id::text||':'||r.to_agent::text)::uuid
    else md5(chan::text||':'||r.to_agent::text)::uuid end,
   asking, target.instructions,
   case when not r.answers_person then (select coalesce(jsonb_agg(jsonb_build_object('name',a.name,'job',a.speciality) order by a.name,a.id),'[]'::jsonb)
    from public.hermes_agents a where a.company_id=r.company_id and a.id<>r.to_agent and a.profile is not null and btrim(a.name)<>'') end;
  return;
 end if;

 if r.state='handing' then
  -- The asked Agent's answer once every job it handed on ended (#477), given up a day after its leg began, and failed
  -- when the asked Agent can no longer run or the chain's person may no longer hand work over: its leg ends as failed and
  -- the Agent that asked it hears so. A lost start given up keeps the session held until its window would have ended.
  if r.answer_started_at is null then
   update public.agent_handovers set answer_started_at=now() where id=h returning answer_started_at into began;
   r.answer_started_at:=began; end if;
  if r.answer_started_at < now()-interval '1 day' or target.id is null or target.profile is null or not public.handover_writer(h) then
   update public.agent_handovers set state='returning', target_outcome='failed', target_closed_at=now(), attempted_at=null, return_started_at=now(),
    session_held_until=case when r.answer_attempts>0 then r.answer_started_at+interval '1 day' end where id=h; return;
  end if;
  if target.profile ~ '^co-[0-9a-f]{32}$'
   and (target.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
  if public.agent_profile_refusal(target.profile,r.company_id,target.id) is not null then return; end if;
  update public.agent_handovers set answer_attempts=answer_attempts+1, attempted_at=now() where id=h returning answer_attempts into r.answer_attempts;
  select string_agg(case when c.target_outcome='completed' and c.summary is not null
     then E'\n\nWhat ' || coalesce(nullif(btrim(t.name),''),'the agent') || E' answered:\n' || c.summary
     else E'\n\n' || coalesce(nullif(btrim(t.name),''),'The agent') || ' did not finish: it '
      || case coalesce(c.target_outcome,'failed') when 'stopped' then 'was stopped' when 'lost' then 'could not be found' else 'failed' end
      || ' before answering.' end, '' order by c.id)
   into came
   from public.agent_handovers c left join public.hermes_agents t on t.id=c.to_agent and t.company_id=c.company_id
   where c.parent_id=h;
  asking := 'The agents you handed parts of your job to have answered, or did not finish.'
   || E'\n\nThe job ' || asker || E' gave you:\n' || r.goal
   || coalesce(came,'')
   || E'\n\nWrite your answer for ' || asker || ' now: what you did, what you found and anything ' || asker || ' must tell the ' || whom || '.'
   || ' Put anything you need from the ' || whom || ' in your answer, and ' || asker || ' will ask them. Write only the answer.';
  return query select 'handing'::text, r.answer_attempts, r.company_id, target.profile,
   case when r.conversation_id is not null then md5(r.conversation_id::text||':'||r.to_agent::text)::uuid
    else md5(chan::text||':'||r.to_agent::text)::uuid end,
   asking, target.instructions, null::jsonb;
  return;
 end if;

 -- A command's handover never reaches a follow-up leg: close_handover_target ends it as done. Any row that arrives here
 -- anyway ends as failed, so nothing asks an Engine to report a job no Lead judged.
 if r.answers_person then
  update public.agent_handovers set state='failed', closed_at=now() where id=h;
  insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
   values(r.company_id,r.conversation_id,r.run_id,'failed') on conflict do nothing;
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
 if asking_agent.id is null or asking_agent.profile is null then
  update public.agent_handovers set state='failed', closed_at=now() where id=h; return; end if;
 if asking_agent.profile ~ '^co-[0-9a-f]{32}$'
  and (asking_agent.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 if public.agent_profile_refusal(asking_agent.profile,r.company_id,asking_agent.id) is not null then return; end if;
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
 return query select 'returning'::text, r.return_attempts, r.company_id, asking_agent.profile,
  case when r.conversation_id is not null then r.conversation_id else md5(chan::text||':'||r.from_agent::text)::uuid end,
  asking, asking_agent.instructions, null::jsonb;
end $function$;
revoke all on function public.begin_handover(bigint) from public,anon,authenticated;
grant execute on function public.begin_handover(bigint) to service_role;

-- 20270320000000's answer_handover, with the asked Agent's answer leg (`handing`): its Run id is kept once and moves it to
-- `answering`; a refused first start ends the leg as failed, and the Agent that asked hears so.
create or replace function public.answer_handover(h bigint, attempt integer, run text, leg text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers;
begin
 select * into r from public.agent_handovers where id=h for update;
 if r.id is null or r.state not in ('waiting','handing','returning') then return false; end if;
 if leg is not null and (leg<>r.state or (r.state='waiting' and r.target_attempts is distinct from attempt)
  or (r.state='handing' and r.answer_attempts is distinct from attempt)
  or (r.state='returning' and r.return_attempts is distinct from attempt)) then return false; end if;
 if run is not null then
  if r.state='waiting' then
   if r.target_run is not null then return r.target_run=run; end if;
   update public.agent_handovers set target_run=run, state='target' where id=h; return true;
  end if;
  if r.state='handing' then
   if r.answer_run is not null then return r.answer_run=run; end if;
   update public.agent_handovers set answer_run=run, state='answering' where id=h; return true;
  end if;
  if r.follow_up_run is not null then return r.follow_up_run=run; end if;
  update public.agent_handovers set follow_up_run=run, state='follow_up' where id=h; return true;
 end if;
 if r.state='waiting' then
  if attempt=1 and r.target_attempts=1 and r.target_run is null then
   update public.agent_handovers set state='returning', target_outcome='failed', attempted_at=null, return_started_at=now() where id=h; return true; end if;
 elsif r.state='handing' then
  if attempt=1 and r.answer_attempts=1 and r.answer_run is null then
   update public.agent_handovers set state='returning', target_outcome='failed', target_closed_at=now(), attempted_at=null, return_started_at=now() where id=h; return true; end if;
 elsif attempt=1 and r.return_attempts=1 and r.follow_up_run is null then
  update public.agent_handovers set state='failed', closed_at=now() where id=h; return true;
 end if;
 return false;
end $$;
revoke all on function public.answer_handover(bigint,integer,text,text) from public,anon,authenticated;
grant execute on function public.answer_handover(bigint,integer,text,text) to service_role;

-- 20270415650000's close_handover_target, and an asked Agent that handed jobs on (#477): a completed Run that kept a child
-- does not close its leg; the handover waits on its children (`handing`) and its answer comes from the answer Run.
do $$
declare def text; was text;
begin
 def:=pg_get_functiondef('public.close_handover_target(bigint,text,text,text)'::regprocedure);
 was:=E' update public.agent_handovers set state=case when answers_person then ''done'' else ''returning'' end, target_outcome=run_outcome,';
 if position(was in def)=0 then raise exception 'close_handover_target changed: %',def; end if;
 execute replace(def,was,
  E' if run_outcome=''completed'' and exists(select 1 from public.agent_handovers c where c.parent_id=h and c.run_id=run) then\n'
  || E'  update public.agent_handovers set state=''handing'', attempted_at=null, answer_started_at=now()\n'
  || E'   where id=h and state=''target'' and target_run=run and target_outcome is null and not answers_person\n'
  || E'   returning * into r;\n'
  || E'  return r.id is not null;\n'
  || E' end if;\n'
  || was);
end $$;

-- The asked Agent's answer Run ended (#477): its reply is the leg's answer, read by the Agent that asked as a target's
-- words are, and kept in the record. Only a completed Run has one. A channel's Card logs it as a reply in that channel.
create function public.close_handover_answer(h bigint, run text, run_outcome text, answer text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','no_model','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(answer),'') <> '')
  then raise exception 'handoverFailed' using errcode='22023'; end if;
 update public.agent_handovers set state='returning', target_outcome=run_outcome,
  summary=case when run_outcome='completed' then left(btrim(answer),8000) end, target_closed_at=now(), attempted_at=null,
  return_started_at=now()
  where id=h and state='answering' and answer_run=run and target_outcome is null
  returning * into r;
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
revoke all on function public.close_handover_answer(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.close_handover_answer(bigint,text,text,text) to service_role;

-- 20270413000000's agent_move_blocked and move_company_profile: the asked Agent's answer Run, or its start whose answer
-- was lost, holds its profile's move as its job's Run does.
do $$
declare def text; was text;
begin
 def:=pg_get_functiondef('public.agent_move_blocked(uuid)'::regprocedure);
 was:='(h.to_agent=agent and (h.state=''target'' or h.state=''waiting'' and h.target_attempts>0))';
 if position(was in def)=0 then raise exception 'agent_move_blocked changed: %',def; end if;
 execute replace(def,was,'(h.to_agent=agent and (h.state in (''target'',''answering'') or h.state=''waiting'' and h.target_attempts>0 or h.state=''handing'' and h.answer_attempts>0))');
 def:=pg_get_functiondef('public.move_company_profile(uuid)'::regprocedure);
 was:='(h.to_agent=any(movers) and (h.state=''target'' or h.state=''waiting'' and h.target_attempts>0))';
 if position(was in def)=0 then raise exception 'move_company_profile changed: %',def; end if;
 execute replace(def,was,'(h.to_agent=any(movers) and (h.state in (''target'',''answering'') or h.state=''waiting'' and h.target_attempts>0 or h.state=''handing'' and h.answer_attempts>0))');
end $$;

-- 20270415950000's conversation_handovers, and which handover a row was handed on from (`parent`): the Conversation draws
-- a chain's every step, a step made inside an asked Agent's Run as its own row. Its return type changes, so it is made
-- again; the previous app version reads its columns by name.
drop function public.conversation_handovers(uuid);
create function public.conversation_handovers(conversation uuid)
returns table(id bigint, run text, from_agent uuid, from_name text, from_connection uuid, to_agent uuid, to_name text,
 to_connection uuid, goal text, answer text, state text, target_outcome text, answers_person boolean, created_at timestamptz, answered_at timestamptz,
 parent bigint)
language sql stable security definer set search_path='' as $$
 select h.id,h.run_id,h.from_agent,f.name,f.connection_id,h.to_agent,t.name,t.connection_id,h.goal,
  case when h.target_outcome='completed' and not h.answers_person then h.summary end,
  h.state,h.target_outcome,h.answers_person,h.created_at,h.target_closed_at,h.parent_id
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
