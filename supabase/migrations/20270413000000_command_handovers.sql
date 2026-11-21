-- #358: a job command sent in the main Agent's Conversation hands its job to the Agent of that role in the same chat.
-- The command is gtmworks's own, never the model's: `command_handover` keeps the person's message and a handover row in
-- one call, the worker starts the target's Run as it starts any handover's (lib/handovers.mjs, begin_handover), and the
-- target's reply is the chat's answer from that Agent (close_handover_target) — there is no follow-up Lead Run, because
-- Lead never judged the job. `answers_person` tells the two apart; every row of #317 and of #150 keeps its follow-up.
--
-- The person's message carries the command key as its Run (`command:<send key>`), which no Engine Run has: the driver
-- closes the handover, not a Conversation's closer, and conversation_open_run and the worker's list of open Runs leave it
-- alone so nothing ever asks the Engine about it. Nothing else changes: a command typed in another Agent's Conversation,
-- or one not listed for this person, is sent as plain text, as before.
--
-- The previous app version runs against this: it creates no answers_person row, and every function it calls answers as
-- it did.
alter table public.agent_handovers add column answers_person boolean not null default false;
grant select (answers_person) on public.agent_handovers to authenticated;
-- A target's start that waited behind another job in the same session (begin_handover): its ten minutes to start count
-- from the last time it was held, not from when it was made, so a job queued behind a long one is never given up for it.
alter table public.agent_handovers add column start_waited_at timestamptz;
-- A start whose answer was lost and then given up (its sender may no longer call the target) may still have a Run going
-- in the target's session: no other job starts there until this, the end of the lost start's one-day window.
alter table public.agent_handovers add column session_held_until timestamptz;

-- The person's message and the handover, once: whoever writes the Company's Conversations, talking to its Lead, for a
-- job the Agent of that role takes — the first Agent made from the role this person sees, in the order the composer lists
-- them, on a profile of its own or the Company's. The words before and after the command are the app's business: the
-- function keeps any job it is given, and a Member could hand the same job to that Agent in its own chat. Anything else
-- answers false and the message is sent as typed.
create function public.command_handover(conversation uuid, c uuid, agent uuid, message_key uuid, message text, role text, goal text)
 returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.conversations; lead public.hermes_agents; target public.hermes_agents; writer text; kept text; job text; saved bigint;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if message is null or length(message) not between 1 and 200000 or message_key is null then raise exception 'conversationNotFound' using errcode='22023'; end if;
 job:=left(btrim(coalesce(goal,'')),500);
 if job='' then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 select * into existing from public.conversations where id=conversation;
 if found and (existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is distinct from agent)
  then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into lead from public.hermes_agents where id=agent and company_id=c;
 if not found or not public.may_hand_to_agent(c,lead.id,auth.uid()) then return false; end if;
 select * into target from public.hermes_agents a
  where a.company_id=c and a.id<>lead.id and a.profile is not null and a.template=role
   and public.agent_visible_to(c,auth.uid(),a.id)
  order by a.name,a.id limit 1;
 if not found then return false; end if;
 kept:='command:'||message_key::text;
 select name into writer from public.people where id=auth.uid();
 insert into public.conversations(id,company_id,person_id,agent_id,agent_name)
  values(conversation,c,auth.uid(),lead.id,lead.name) on conflict (id) do nothing;
 insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
  values(c,conversation,'person',auth.uid(),coalesce(writer,''),message,message_key,kept) on conflict do nothing
  returning id into saved;
 -- A send key already stored as another Run is no command: nothing is handed over, and the caller sends it as typed.
 if saved is null then
  return exists(select 1 from public.conversation_messages m
   where m.conversation_id=conversation and m.send_key=message_key and m.run_id=kept);
 end if;
 insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,answers_person)
  values(c,conversation,kept,message_key::text,lead.id,target.id,job,true) on conflict do nothing;
 return true;
end $$;
revoke all on function public.command_handover(uuid,uuid,uuid,uuid,text,text,text) from public,anon,service_role;
grant execute on function public.command_handover(uuid,uuid,uuid,uuid,text,text,text) to authenticated;

-- The Run of a Conversation that has not ended: a person's message with no reply and no recorded outcome. A job
-- command's Run is the target Agent's, answered when its handover ends, so the chat's Agent never works on it and none
-- of its messages wait behind it.
create or replace function public.conversation_open_run(conversation uuid) returns table(message bigint, run text, person uuid, author_name text) language sql stable security definer set search_path='' as $$
 select m.id,m.run_id,m.person_id,m.author_name from public.conversation_messages m
 where m.conversation_id=conversation and m.author='person'
  and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
  and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)
  and not exists(select 1 from public.agent_handovers h where h.conversation_id=m.conversation_id and h.run_id=m.run_id and h.answers_person)
 order by m.id desc limit 1;
$$;
revoke all on function public.conversation_open_run(uuid) from public,anon,authenticated,service_role;

-- 20270401000000's, leaving out the command's Run for the same reason: no Engine Run of the chat's Agent is open there.
create or replace function public.open_conversation_runs(just uuid default null, owner uuid default null, after bigint default 0)
 returns table(message bigint, conversation uuid, run text, person uuid, profile text, company uuid) language sql stable security definer set search_path='' as $function$
 select m.id,m.conversation_id,m.run_id,c.person_id,a.profile,c.company_id from public.conversation_messages m
 join public.conversations c on c.id=m.conversation_id left join public.hermes_agents a on a.id=c.agent_id and a.company_id=c.company_id
 where m.author='person' and m.id>after and (just is null or m.conversation_id=just) and (owner is null or c.person_id=owner)
  and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
  and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)
  and not exists(select 1 from public.agent_handovers h where h.conversation_id=m.conversation_id and h.run_id=m.run_id and h.answers_person)
 order by m.id limit 500;
$function$;
revoke all on function public.open_conversation_runs(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.open_conversation_runs(uuid,uuid,bigint) to service_role;

-- 20270329000000's begin_handover, with the job a command hands over: the whole of the person's own message reaches its
-- Agent, it writes the reply the person reads rather than a report for Lead, and a leg that cannot start ends the
-- person's Run as failed, so the chat says the reply did not come. Two jobs to one Agent in one chat never run at once:
-- they share its session there, so the second waits for the first to settle.
create or replace function public.begin_handover(h bigint)
 returns table(state text, attempt integer, company uuid, profile text, session uuid, input text, instructions text)
 language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers; talk public.conversations; chan uuid; person uuid; target public.hermes_agents; lead public.hermes_agents; asking text; began timestamptz; job text;
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
 -- Lead's session. A start held here notes when, so its ten minutes count from the moment it could go.
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
  select * into lead from public.hermes_agents where id=talk.agent_id and talk.company_id=r.company_id;
  person := talk.person_id;
 else
  select m.channel_id, m.person_id into chan, person from public.channel_messages m where m.id=r.channel_message_id;
  select * into lead from public.hermes_agents where id=r.from_agent and r.company_id=r.company_id;
 end if;

 if r.state='waiting' then
  -- Given up (a start that never came within ten minutes, or a lost one within a day), a target that cannot run at all,
  -- or one no longer the person's to call (#354): no Run starts. A command's handover ends there, its target never
  -- answering, so the person's own Run ends as failed and the chat says the reply did not come; a #317 or #150 job goes
  -- on to Lead's follow-up, which tells the person.
  -- Both windows count from when the start could go: when the job was made, or the last time another job held it.
  -- A lost start given up here keeps the target's session held until its own window would have ended.
  if (r.target_attempts=0 and coalesce(r.start_waited_at,r.created_at) < now()-interval '10 minutes')
   or (r.target_attempts>0 and coalesce(r.start_waited_at,r.created_at) < now()-interval '1 day')
   or target.id is null or target.profile is null
   or (r.conversation_id is not null and not public.agent_visible_to(r.company_id, person, target.id))
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

-- 20270329000000's close_handover_target, with the job a command handed over: its words are the chat's answer from that
-- Agent, kept once, and its end closes the person's Run, so the chat stops waiting and says so when it failed. The
-- handover is done there and then: no Lead follow-up follows a job Lead never judged.
create or replace function public.close_handover_target(h bigint, run text, run_outcome text, words text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers; target public.hermes_agents;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(words),'') <> '')
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

-- 20270331000010's agent_move_blocked, with a command's Run left out: it is no Run of the Conversation's Agent, so a
-- job a command handed over never holds that Agent's profile move. The handover's own leg still does (the last clause).
create or replace function public.agent_move_blocked(agent uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   where cv.agent_id=agent and m.author='person'
    and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
    and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)
    and not exists(select 1 from public.agent_handovers h where h.conversation_id=m.conversation_id and h.run_id=m.run_id and h.answers_person))
  or exists(select 1 from public.conversation_run_reservations r where r.agent_id=agent and r.abandoned_at is null)
  or exists(select 1 from public.channel_runs r where r.agent_id=agent and r.outcome is null)
  or exists(select 1 from public.note_runs r where r.agent_id=agent and r.outcome is null)
  or exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   where cv.agent_id=agent and m.created_at>now()-interval '5 minutes')
  or exists(select 1 from public.agent_handovers h where h.state not in ('done','failed')
   and ((h.to_agent=agent and (h.state='target' or h.state='waiting' and h.target_attempts>0))
    or (h.from_agent=agent and (h.state='follow_up' or h.state='returning' and h.return_attempts>0))));
$$;
revoke all on function public.agent_move_blocked(uuid) from public,anon,authenticated,service_role;

-- 20270331000010's move_company_profile, with the same command's Run left out of the messages that hold a Company's move.
create or replace function public.move_company_profile(c uuid) returns integer language plpgsql security definer set search_path='' as $function$
declare first_owner uuid; movers uuid[]; agent uuid; moved integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if not public.company_profile_ready(c) then return 0; end if;
 select m.person_id into first_owner from public.members m where m.company_id=c and m.role='owner' and m.removed_at is null order by m.person_id limit 1;
 if first_owner is null then return 0; end if;
 movers:=array(select a.id from public.hermes_agents a where a.company_id=c and a.profile<>public.company_engine_profile(c) and a.profile !~ '^ag-[0-9a-f]{32}$');
 if exists(select 1 from public.conversation_run_reservations r where r.agent_id=any(movers) and r.abandoned_at is null)
  or exists(select 1 from public.channel_runs r where r.agent_id=any(movers) and r.outcome is null)
  or exists(select 1 from public.note_runs r where r.agent_id=any(movers) and r.outcome is null)
  or exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   where cv.company_id=c and cv.agent_id=any(movers) and m.created_at>now()-interval '5 minutes')
  or exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   where cv.company_id=c and cv.agent_id=any(movers) and m.author='person'
    and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
    and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)
    and not exists(select 1 from public.agent_handovers h where h.conversation_id=m.conversation_id and h.run_id=m.run_id and h.answers_person))
  or exists(select 1 from public.agent_handovers h where h.state not in ('done','failed')
   and ((h.to_agent=any(movers) and (h.state='target' or h.state='waiting' and h.target_attempts>0))
    or (h.from_agent=any(movers) and (h.state='follow_up' or h.state='returning' and h.return_attempts>0)))) then
  return 0;
 end if;
 for agent in update public.hermes_agents set profile=public.company_engine_profile(c),connection_id=gen_random_uuid() where id=any(movers) returning id loop
  perform public.log_agent_event(c,first_owner,null,agent,'MOVE_COMPANY_PROFILE','{}');
  moved:=moved+1;
 end loop;
 return moved;
end $function$;
revoke all on function public.move_company_profile(uuid) from public,anon,authenticated;
grant execute on function public.move_company_profile(uuid) to service_role;
