-- #475 (spec #474, decision 0057, replacing decision 0043 point 6): any Agent of a Company, not only its main Agent, hands
-- a job to any other Agent of the same Company from a Conversation. The person whose message started the Run must still
-- be a writer of the Company (an Owner, a Manager or a Contributor), as before; the target is any Agent of that Company
-- but the asking one, whether or not the person may see it or talk to it. An Agent of another Company is never a target,
-- and a name that matches none is ignored, so the Run still closes.
--
-- The tool names its targets: conversation_handover_agents lists the Company's other Agents with their job line for a
-- Run, read from that Run's reservation as pin_run reads it (a first message has no Conversation row yet), and
-- the app makes that list the tool's enum (lib/agent-tools.mjs), pinned with the Run by pin_run as every tool's text is.
-- The Conversation draws each handover from gtmworks's own record through conversation_handovers: the row "{asking
-- Agent} asked {asked Agent}", the asked Agent's answer under its own name, then the asking Agent's reply. The record
-- follows the Conversation's own read rule, so its person reads it whether or not they see the asked Agent.
--
-- This is one level only: the asked Agent's Run is still offered no tools and told not to hand the job on (the chain is
-- #477), and a channel's handover is unchanged (#476). A job command (#358) still hands over only from the main Agent.
--
-- The previous app version runs against this: every function keeps its signature and its answer's shape, the read
-- policy only widens, and the two new functions are called by this version alone. Its pinned tool texts hold no enum, so
-- a non-main Agent's Run it starts is offered the plain hand_to_agent text, which this database carries out the same way.

-- Who may hand work over in a Conversation: a writer of the Company, talking to any Agent of that Company.
create or replace function public.may_hand_to_agent(c uuid, agent uuid, person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role in ('owner','manager','contributor') and m.removed_at is null)
  and exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c);
$$;
revoke all on function public.may_hand_to_agent(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- A job command (#358) is the main Agent's alone, as it was: 20270413000000's command_handover asks may_hand_to_agent,
-- which no longer says the Agent is the main one, so the command now asks that itself.
do $$
declare def text;
begin
 def:=pg_get_functiondef('public.command_handover(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure);
 if position('not public.may_hand_to_agent(c,lead.id,auth.uid())' in def)=0 then raise exception 'command_handover changed: %',def; end if;
 execute replace(def,'not public.may_hand_to_agent(c,lead.id,auth.uid())','not public.may_hand_to_agent(c,lead.id,auth.uid()) or not public.is_company_lead(c,lead.id)');
end $$;

-- The Agents a Conversation's Run may hand work to, as the tool names them: every other Agent of the Company that can
-- run, each with its job line, by name. The Run is its reservation, as pin_run reads it: the Agent it was reserved for
-- and the person who sent it. None when that person may not hand work over to anyone.
create function public.conversation_handover_agents(conversation uuid, message_key uuid) returns table(name text, job text)
language sql stable security definer set search_path='' as $$
 select a.name, a.speciality
 from public.conversation_run_reservations r
  join public.hermes_agents a on a.company_id=r.company_id
 where r.conversation_id=conversation_handover_agents.conversation and r.send_key=message_key and r.agent_id is not null
  and a.id<>r.agent_id and a.profile is not null and btrim(a.name)<>'' and public.may_hand_to_agent(r.company_id,r.agent_id,r.person_id)
 order by a.name, a.id;
$$;
revoke all on function public.conversation_handover_agents(uuid,uuid) from public,anon,authenticated;
grant execute on function public.conversation_handover_agents(uuid,uuid) to service_role;

-- 20270324000000's lead_hand_to_agent, with any Agent of the Conversation as the one who asks and any other Agent of its
-- Company as the target, seen by the person or not. The Card follows a handover only from the main Agent (#147): a chat
-- with the main Agent puts no Card on the board by itself, while any other Agent's chat already owns its own Card, which
-- keeps its Agent and only gains the handover's log row.
create or replace function public.lead_hand_to_agent(conversation uuid, run text, call text, agent_name text, goal text, context text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare talk public.conversations; target public.hermes_agents; handed public.agent_handovers; asker text; main boolean;
 card bigint; card_agent uuid; stage bigint; first_words text;
begin
 select * into talk from public.conversations where id=conversation;
 -- A call that cannot be carried out answers as a value, never an error: the run that made it still closes.
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  then return jsonb_build_object('state','refused'); end if;
 if talk.agent_id is null or not public.may_hand_to_agent(talk.company_id,talk.agent_id,talk.person_id)
  then return jsonb_build_object('state','refused'); end if;
 if coalesce(agent_name,'') = '' or coalesce(goal,'') = '' then return jsonb_build_object('state','ignored'); end if;
 select * into target from public.hermes_agents a
  where a.company_id=talk.company_id and a.id<>talk.agent_id and a.profile is not null
   and lower(btrim(a.name))=lower(btrim(agent_name))
  order by a.id limit 1;
 if not found then return jsonb_build_object('state','ignored'); end if;
 insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,context)
  values(talk.company_id,conversation,run,call,talk.agent_id,target.id,btrim(goal),nullif(btrim(coalesce(context,'')),''))
  on conflict (conversation_id,run_id,call_id) do nothing returning * into handed;
 -- The same call again keeps nothing twice: one handover, and so one Card and one log row.
 if handed.id is not null then
  main:=public.is_company_lead(talk.company_id,talk.agent_id);
  select w.id,w.agent_id into card,card_agent from public.work_cards w where w.company_id=talk.company_id and w.conversation_id=conversation;
  if card is null and main then
   -- As #144's Card: the Company's first stage In progress, titled from the person's first message in this chat.
   select s.id into stage from public.work_stages s where s.company_id=talk.company_id and s.board_column='progress' and s.kind='before_review' order by s.position,s.id limit 1;
   if stage is not null then
    select m.body into first_words from public.conversation_messages m where m.conversation_id=conversation and m.author='person' order by m.id limit 1;
    insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id)
     values(talk.company_id,stage,public.chat_card_title(first_words,target.name),target.id,conversation)
     on conflict (conversation_id) where conversation_id is not null do nothing returning id into card;
    -- #354: when two handovers race, the second insert finds the first's Card and takes it, giving it the Agent it
    -- handed the work to as a later handover does, and keeping that Card's stage and title.
    if card is null then
     select w.id into card from public.work_cards w where w.company_id=talk.company_id and w.conversation_id=conversation;
     if card is not null then
      update public.work_cards set agent_id=target.id
       where company_id=talk.company_id and id=card and agent_id is distinct from target.id; end if;
    end if;
   end if;
  elsif card is not null and main and card_agent is distinct from target.id then
   update public.work_cards set agent_id=target.id where company_id=talk.company_id and id=card;
  end if;
  if card is not null then
   select a.name into asker from public.hermes_agents a where a.company_id=talk.company_id and a.id=talk.agent_id;
   -- The one who handed the work is the row's actor and the Agent it went to is the Agent the row is about, so a Member
   -- who does not see either one reads no row (company_log_read) and no name in the Card's crew (crew).
   insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
    values(talk.company_id,talk.agent_id,'agent',asker,'card',card,target.id,'agent_handed_to',
     jsonb_build_object('agent_name',asker,'to_name',target.name,'goal',handed.goal),'agent_handovers',handed.id,handed.created_at)
    on conflict (source,source_id) do nothing;
  end if;
 end if;
 return jsonb_build_object('state','created','agent',target.name);
end $$;
revoke all on function public.lead_hand_to_agent(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.lead_hand_to_agent(uuid,text,text,text,text,text) to service_role;

-- 20270101000000's conversation_reply_card, which puts any other Agent's chat on the board with that Agent's first
-- reply (#144). A handover made in that first Run is kept before the reply is written, when the chat has no Card yet, so
-- lead_hand_to_agent could not write its log row: the Card made here writes it, once per handover, and stays the asking
-- Agent's.
create or replace function public.conversation_reply_card() returns trigger language plpgsql security definer set search_path='' as $$
declare chat public.conversations; agent public.hermes_agents; asked public.conversation_messages; stage bigint; card bigint;
begin
 select * into chat from public.conversations where id=new.conversation_id;
 select * into agent from public.hermes_agents where id=chat.agent_id and company_id=chat.company_id;
 if not found or agent.is_default then return null; end if;
 select * into asked from public.conversation_messages where conversation_id=chat.id and author='person' order by id limit 1;
 if asked.run_id is distinct from new.run_id
  or exists(select 1 from public.agent_rules where conversation_id=chat.id and run_id=new.run_id)
  or exists(select 1 from public.lead_made_agents where conversation_id=chat.id and run_id=new.run_id)
  or exists(select 1 from public.lead_agent_requests where conversation_id=chat.id and run_id=new.run_id) then return null; end if;
 -- A stage after review takes a Card only through an approval (approval_card_guard), which a new Card has not had.
 select id into stage from public.work_stages where company_id=chat.company_id and board_column='progress' and kind='before_review' order by position,id limit 1;
 if stage is null then return null; end if;
 insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id)
  values(chat.company_id,stage,public.chat_card_title(asked.body,agent.name),agent.id,chat.id)
  on conflict (conversation_id) where conversation_id is not null do nothing returning id into card;
 if card is not null then
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
   select h.company_id,h.from_agent,'agent',f.name,'card',card,h.to_agent,'agent_handed_to',
    jsonb_build_object('agent_name',f.name,'to_name',t.name,'goal',h.goal),'agent_handovers',h.id,h.created_at
   from public.agent_handovers h
    join public.hermes_agents f on f.id=h.from_agent and f.company_id=h.company_id
    join public.hermes_agents t on t.id=h.to_agent and t.company_id=h.company_id
   where h.conversation_id=chat.id and h.company_id=chat.company_id
   order by h.id
   on conflict (source,source_id) do nothing;
 end if;
 return null;
end $$;
revoke all on function public.conversation_reply_card() from public,anon,authenticated,service_role;

-- 20270413000000's begin_handover, with two changes for a Conversation's handover. The target is no longer checked
-- against what the person sees: any Agent of the Company may be asked (a job command still is, since the command picks
-- an Agent the person sees). The job names the Agent that asked, not "Lead", since any Agent may ask.
create or replace function public.begin_handover(h bigint)
 returns table(state text, attempt integer, company uuid, profile text, session uuid, input text, instructions text)
 language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers; talk public.conversations; chan uuid; person uuid; target public.hermes_agents; asking_agent public.hermes_agents; asking text; began timestamptz; job text; asker text;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.agent_handovers where id=h for update;
 if r.id is null or r.state not in ('waiting','returning') then return; end if;
 if r.attempted_at is not null and r.attempted_at > now()-interval '30 seconds' then return; end if;
 -- A target works in one session per chat (or channel): a second job to the same Agent waits while the first may still
 -- be running — an open Run, or a start whose answer was lost (target_attempts above zero, as #354 reads one). Every
 -- handover of that place and Agent is counted, not only a command's, since they share the session: a Conversation's by
 -- its id, a channel's by its channel (the target's session there is the channel's, whatever message made the handover).
 -- The row itself is left out, so a lost start still retries. A lost start given up since may still be running, so it
 -- holds the session until its window ends (session_held_until). Only the target's start waits: a follow-up leg runs in
 -- the asking Agent's session. A start held here notes when, so its ten minutes count from the moment it could go.
 if r.state='waiting' and exists(select 1 from public.agent_handovers o
  where o.id<>h and o.to_agent=r.to_agent
   and (case when r.conversation_id is not null then o.conversation_id=r.conversation_id
     else exists(select 1 from public.channel_messages mine join public.channel_messages theirs on theirs.channel_id=mine.channel_id
      where mine.id=r.channel_message_id and theirs.id=o.channel_message_id) end)
   and (o.state='target' or o.state='waiting' and o.target_attempts>0 or o.session_held_until>now())) then
  if r.target_attempts=0 then update public.agent_handovers set start_waited_at=now() where id=h; end if;
  return;
 end if;
 select * into target from public.hermes_agents where id=r.to_agent;
 if r.conversation_id is not null then
  select * into talk from public.conversations where id=r.conversation_id;
  select * into asking_agent from public.hermes_agents where id=talk.agent_id and talk.company_id=r.company_id;
  person := talk.person_id;
 else
  select m.channel_id, m.person_id into chan, person from public.channel_messages m where m.id=r.channel_message_id;
  select * into asking_agent from public.hermes_agents where id=r.from_agent and r.company_id=r.company_id;
 end if;
 select a.name into asker from public.hermes_agents a where a.id=r.from_agent and a.company_id=r.company_id;
 asker := coalesce(nullif(btrim(asker),''),'Lead');

 if r.state='waiting' then
  -- Given up (a start that never came within ten minutes, or a lost one within a day), a target that cannot run at all,
  -- or, for a job command or a channel, one no longer the person's to call (#354): no Run starts. A command's handover
  -- ends there, its target never answering, so the person's own Run ends as failed and the chat says the reply did not
  -- come; any other job goes on to the asking Agent's follow-up, which tells the person.
  -- Both windows count from when the start could go: when the job was made, or the last time another job held it.
  -- A lost start given up here keeps the target's session held until its own window would have ended.
  if (r.target_attempts=0 and coalesce(r.start_waited_at,r.created_at) < now()-interval '10 minutes')
   or (r.target_attempts>0 and coalesce(r.start_waited_at,r.created_at) < now()-interval '1 day')
   or target.id is null or target.profile is null
   or (r.answers_person and not public.agent_visible_to(r.company_id, person, target.id))
   or (r.conversation_id is null and not public.channel_agent(chan, person, target.id)) then
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
  elsif r.conversation_id is not null then
   asking := asker || ' in the team is handing you a job in one of the team''s chats.'
    || E'\n\nThe job:\n' || r.goal
    || coalesce(E'\n\nWhat ' || asker || E' knows about the job:\n' || r.context,'')
    || E'\n\nDo the job now. Reply with your result for ' || asker || ': what you did, what you found and anything ' || asker || ' must tell the person. Do not ask anyone a question: nobody but ' || asker || ' reads this chat.'
    || E'\n\nDo not save anything to memory, do not schedule anything, and do not hand the job on.';
  else
   asking := 'Lead in the team is handing you a job in this channel.'
    || E'\n\nThe job:\n' || r.goal
    || coalesce(E'\n\nWhat Lead knows about the job:\n' || r.context,'')
    || E'\n\nDo the job now. Reply with your result for Lead: what you did, what you found and anything Lead must tell the team. Do not ask anyone a question: your reply is what Lead reports, so write the result, not a question.'
    || E'\n\nDo not save anything to memory, do not schedule anything, and do not hand the job on.';
  end if;
  -- The target works in a session of its own for this chat (its own in the channel), never the asking Agent's: an Agent
  -- on the Company's profile shares Lead's profile, and the asking Agent's session holds only what it was told.
  return query select 'waiting'::text, r.target_attempts, r.company_id, target.profile,
   case when r.conversation_id is not null then md5(r.conversation_id::text||':'||r.to_agent::text)::uuid
    else md5(chan::text||':'||r.to_agent::text)::uuid end,
   asking, target.instructions;
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
  asking, asking_agent.instructions;
end $$;
revoke all on function public.begin_handover(bigint) from public,anon,authenticated;
grant execute on function public.begin_handover(bigint) to service_role;

-- The Conversation's handovers follow the Conversation's own read rule (conversations_read): its person, while they are
-- a Member who sees the Agent they talk to, reads every handover of it, whichever Agent was asked.
alter policy agent_handovers_read on public.agent_handovers using (exists(select 1 from public.conversations c
 where c.id=conversation_id and c.company_id=agent_handovers.company_id and c.person_id=auth.uid()
  and public.is_member(c.company_id) and public.can_see_agent(c.company_id,c.agent_id)));

-- What the Conversation draws of its handovers, oldest first: both Agents' names and faces (an asked Agent hidden from
-- the person included, which the person cannot read from hermes_agents), the job, what the asked Agent answered and
-- when, and how far the handover got. Never the context or the Engine's run ids of the legs; `run` is the asking
-- Agent's Run the row sits under, which its person already reads. Only the Conversation's own person reads them, by the
-- read rule above.
create function public.conversation_handovers(conversation uuid)
returns table(id bigint, run text, from_agent uuid, from_name text, from_connection uuid, to_agent uuid, to_name text,
 to_connection uuid, goal text, answer text, state text, answers_person boolean, created_at timestamptz, answered_at timestamptz)
language sql stable security definer set search_path='' as $$
 select h.id,h.run_id,h.from_agent,f.name,f.connection_id,h.to_agent,t.name,t.connection_id,h.goal,
  case when h.target_outcome='completed' and not h.answers_person then h.summary end,
  h.state,h.answers_person,h.created_at,h.target_closed_at
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
