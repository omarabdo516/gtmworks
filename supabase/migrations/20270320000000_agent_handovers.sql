-- #317: Lead hands a job to another Agent of the same Company (decision 0043: only the Lead hands work over). The
-- pinned Engine cannot run one task as an Agent's profile chosen for it and its helper events name no profile, so
-- gtmworks carries the handover itself, with no change inside the Engine (ADR 0012): a `hand_to_agent` call in Lead's
-- reply is kept when Lead's Run closes (lead_hand_to_agent), the job then runs on the target Agent's own profile (ADR
-- 0016), and once it ends a follow-up Lead Run in the same Conversation session reports what came of it. The Engine
-- carries neither the handover nor the target's result: agent_handovers is the record the chat draws.
--
-- Nothing existing is rewritten but run_tools, which offers the Lead one more tool. The previous app version runs
-- against this: its own run's specs hold no hand_to_agent text, so pin_run offers it none, and the four functions it
-- calls are unchanged.

-- Who may hand work over: a writer of the Company (an Owner, a Manager or a Contributor) talking to the Lead. A Viewer
-- writes nothing, and no other Agent hands on (decision 0043).
create function public.may_hand_to_agent(c uuid, agent uuid, person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role in ('owner','manager','contributor') and m.removed_at is null)
  and public.is_company_lead(c,agent);
$$;
revoke all on function public.may_hand_to_agent(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- One row per handover: the Conversation, Lead's Run and call (one each), who handed what to whom, the goal and the
-- context that went with it, then the target's Run and how it ended, and the follow-up Lead Run.
-- `state` moves 'waiting' (the target's Run is not started) -> 'target' (started) -> 'returning' (ended; the follow-up
-- is not started) -> 'follow_up' (started) -> 'done'. 'failed' is a follow-up that could not start at all.
create table public.agent_handovers (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 conversation_id uuid not null,
 run_id text not null,
 call_id text not null,
 from_agent uuid not null references public.hermes_agents(id) on delete cascade,
 to_agent uuid not null references public.hermes_agents(id) on delete cascade,
 goal text not null constraint agent_handovers_goal check (length(btrim(goal)) between 1 and 500),
 context text constraint agent_handovers_context check (context is null or length(btrim(context)) between 1 and 2000),
 state text not null default 'waiting' constraint agent_handovers_state check (state in ('waiting','target','returning','follow_up','done','failed')),
 target_attempts integer not null default 0 constraint agent_handovers_target_attempts check (target_attempts >= 0),
 return_attempts integer not null default 0 constraint agent_handovers_return_attempts check (return_attempts >= 0),
 attempted_at timestamptz,
 target_run text,
 target_outcome text constraint agent_handovers_target_outcome check (target_outcome in ('completed','failed','stopped','lost')),
 summary text constraint agent_handovers_summary check (summary is null or length(summary) between 1 and 8000),
 follow_up_run text,
 follow_up_outcome text constraint agent_handovers_follow_up_outcome check (follow_up_outcome in ('completed','failed','stopped','lost')),
 created_at timestamptz not null default now(),
 closed_at timestamptz,
 foreign key (conversation_id, company_id) references public.conversations(id, company_id),
 unique (conversation_id, run_id, call_id),
 constraint agent_handovers_other_agent check (from_agent <> to_agent),
 constraint agent_handovers_closed check ((state in ('done','failed')) = (closed_at is not null)),
 constraint agent_handovers_target_run check (state <> 'target' or target_run is not null),
 constraint agent_handovers_follow_up_run check (state <> 'follow_up' or follow_up_run is not null),
 constraint agent_handovers_summary_only_reported check ((target_outcome = 'completed') = (summary is not null))
);
create index agent_handovers_due on public.agent_handovers(id) where state not in ('done','failed');

-- The Conversation's person reads the handovers of it, and only those made with Agents they see: a chat that handed work
-- to an Agent hidden from them says nothing of it (design-reference, canSee).
alter table public.agent_handovers enable row level security;
create policy agent_handovers_read on public.agent_handovers for select to authenticated
 using (exists(select 1 from public.conversations c where c.id=conversation_id and c.company_id=agent_handovers.company_id and c.person_id=auth.uid())
  and public.can_see_agent(company_id,from_agent) and public.can_see_agent(company_id,to_agent));
revoke all on public.agent_handovers from anon,authenticated,service_role;
-- What the row draws: the target Agent's name and face, the job, and which side of the record it belongs to. Never the
-- context, the summary or the Engine's run ids.
grant select (id,company_id,conversation_id,run_id,from_agent,to_agent,goal,state,created_at) on public.agent_handovers to authenticated;

-- The handover Lead's call keeps, once per Conversation, run and call. `agent_name` is the name the team knows: only an
-- Agent of the same Company, visible to the person, on a profile of its own or the Company's, is a target. Anything
-- else is ignored, so a reply whose target does not exist still closes its Run (lib/agent-tools.mjs).
create function public.lead_hand_to_agent(conversation uuid, run text, call text, agent_name text, goal text, context text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare talk public.conversations; target public.hermes_agents;
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
   and lower(btrim(a.name))=lower(btrim(agent_name)) and public.agent_visible_to(talk.company_id,talk.person_id,a.id)
  order by a.id limit 1;
 if not found then return jsonb_build_object('state','ignored'); end if;
 insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,context)
  values(talk.company_id,conversation,run,call,talk.agent_id,target.id,btrim(goal),nullif(btrim(coalesce(context,'')),''))
  on conflict (conversation_id,run_id,call_id) do nothing;
 return jsonb_build_object('state','created','agent',target.name);
end $$;
revoke all on function public.lead_hand_to_agent(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.lead_hand_to_agent(uuid,text,text,text,text,text) to service_role;

-- The worker's list: each handover with a leg still to move, as the leg's profile and attempts. A target or follow-up
-- Run is always read; a leg not started yet waits thirty seconds after its last attempt, so one Engine's failure never
-- spins. `run` is the Run to read, none for a leg still to start.
create function public.handovers_due(just_conversation uuid default null, after bigint default 0)
 returns table(id bigint, state text, conversation uuid, run text, profile text, attempt integer)
 language sql stable security definer set search_path='' as $$
 select h.id, h.state, h.conversation_id,
  case h.state when 'target' then h.target_run when 'follow_up' then h.follow_up_run end,
  case h.state
   when 'target' then (select a.profile from public.hermes_agents a where a.id=h.to_agent)
   when 'follow_up' then (select a.profile from public.conversations c join public.hermes_agents a on a.id=c.agent_id and a.company_id=c.company_id where c.id=h.conversation_id)
   else null end,
  case h.state when 'returning' then h.return_attempts else h.target_attempts end
 from public.agent_handovers h
 where h.state not in ('done','failed') and h.id > coalesce(after,0)
  and (just_conversation is null or h.conversation_id=just_conversation)
  and (h.state in ('target','follow_up') or h.attempted_at is null or h.attempted_at < now()-interval '30 seconds')
 order by h.id limit 500;
$$;
revoke all on function public.handovers_due(uuid,bigint) from public,anon,authenticated;
grant execute on function public.handovers_due(uuid,bigint) to service_role;

-- One leg's start: what to send, on which profile, in which session (the target's own for this chat, Lead's for the follow-up), and which attempt of the leg it is.
-- A target Run is never started on a profile the Company may not use, and a leg whose target has no profile at all is
-- finished as failed, so Lead is still told. Given up: never started after ten minutes, a start whose answer was lost
-- after a day (ADR 0015).
create function public.begin_handover(h bigint)
 returns table(state text, attempt integer, company uuid, profile text, session uuid, input text, instructions text)
 language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers; talk public.conversations; target public.hermes_agents; lead public.hermes_agents; asking text;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.agent_handovers where id=h for update;
 if r.id is null or r.state not in ('waiting','returning') then return; end if;
 if r.attempted_at is not null and r.attempted_at > now()-interval '30 seconds' then return; end if;
 select * into talk from public.conversations where id=r.conversation_id;
 select * into target from public.hermes_agents where id=r.to_agent;
 select * into lead from public.hermes_agents where id=talk.agent_id and talk.company_id=r.company_id;

 if r.state='waiting' then
  if r.target_attempts=0 and r.created_at < now()-interval '10 minutes'
   or r.target_attempts>0 and r.created_at < now()-interval '1 day' then
   update public.agent_handovers set state='returning', target_outcome='failed', attempted_at=null where id=h; return; end if;
  if target.id is null or target.profile is null then
   update public.agent_handovers set state='returning', target_outcome='failed', attempted_at=null where id=h; return; end if;
  -- ADR 0014: a Company profile serves its own Company, and no Run starts while its tools are pending. Waits.
  if target.profile ~ '^co-[0-9a-f]{32}$'
   and (target.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
  -- ADR 0016: an Agent profile serves its own Agent, on the same terms. Waits.
  if public.agent_profile_refusal(target.profile,r.company_id,target.id) is not null then return; end if;
  update public.agent_handovers set target_attempts=target_attempts+1, attempted_at=now() where id=h returning target_attempts into r.target_attempts;
  asking := 'Lead in the team is handing you a job in one of the team''s chats.'
   || E'\n\nThe job:\n' || r.goal
   || coalesce(E'\n\nWhat Lead knows about the job:\n' || r.context,'')
   || E'\n\nDo the job now. Reply with your result for Lead: what you did, what you found and anything Lead must tell the person. Do not ask anyone a question: nobody but Lead reads this chat.';
  -- The target works in a session of its own for this chat, never Lead's: an Agent on the Company's profile shares
  -- Lead's profile, and Lead's session holds only what Lead was told.
  return query select 'waiting'::text, r.target_attempts, r.company_id, target.profile, md5(r.conversation_id::text||':'||r.to_agent::text)::uuid, asking, target.instructions;
  return;
 end if;

 if lead.id is null or lead.profile is null then
  update public.agent_handovers set state='failed', closed_at=now() where id=h; return; end if;
 if lead.profile ~ '^co-[0-9a-f]{32}$'
  and (lead.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 if public.agent_profile_refusal(lead.profile,r.company_id,lead.id) is not null then return; end if;
 update public.agent_handovers set return_attempts=return_attempts+1, attempted_at=now() where id=h returning return_attempts into r.return_attempts;
 if r.target_outcome='completed' then
  asking := 'You handed this job to ' || target.name || ' in this conversation, and it has finished.'
   || E'\n\nThe job:\n' || r.goal
   || E'\n\nWhat ' || target.name || ' reported:\n' || coalesce(r.summary,'')
   || E'\n\nWrite your reply to the person now, in their language: what came of the job, and what they should know. Write only the reply.';
 else
  asking := 'You handed this job to ' || target.name || ' in this conversation, and it did not finish: it '
   || case coalesce(r.target_outcome,'failed') when 'stopped' then 'was stopped' when 'lost' then 'could not be found' else 'failed' end
   || ' before reporting anything.'
   || E'\n\nThe job:\n' || r.goal
   || E'\n\nWrite your reply to the person now, in their language: say the job did not finish, and what you suggest. Write only the reply.';
 end if;
 return query select 'returning'::text, r.return_attempts, r.company_id, lead.profile, r.conversation_id, asking, lead.instructions;
end $$;
revoke all on function public.begin_handover(bigint) from public,anon,authenticated;
grant execute on function public.begin_handover(bigint) to service_role;

-- The Engine's answer to a leg's attempt. A run id is kept once; null (refused) moves the leg on only for a first
-- attempt while no later one was made, since only a first start can prove nothing started (ADR 0015). An unknown answer
-- is not reported: the row stays attempted, and the next pass asks again with the same key and body.
create function public.answer_handover(h bigint, attempt integer, run text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers;
begin
 select * into r from public.agent_handovers where id=h for update;
 if r.id is null or r.state not in ('waiting','returning') then return false; end if;
 if run is not null then
  if r.state='waiting' then
   if r.target_run is not null then return r.target_run=run; end if;
   update public.agent_handovers set target_run=run, state='target' where id=h; return true;
  end if;
  if r.follow_up_run is not null then return r.follow_up_run=run; end if;
  update public.agent_handovers set follow_up_run=run, state='follow_up' where id=h; return true;
 end if;
 if r.state='waiting' then
  if attempt=1 and r.target_attempts=1 and r.target_run is null then
   update public.agent_handovers set state='returning', target_outcome='failed', attempted_at=null where id=h; return true; end if;
 elsif attempt=1 and r.return_attempts=1 and r.follow_up_run is null then
  update public.agent_handovers set state='failed', closed_at=now() where id=h; return true;
 end if;
 return false;
end $$;
revoke all on function public.answer_handover(bigint,integer,text) from public,anon,authenticated;
grant execute on function public.answer_handover(bigint,integer,text) to service_role;

-- The target's Run ended: its summary is what Lead's follow-up Run is given, and it stays in the record. Only a
-- completed Run has one.
create function public.close_handover_target(h bigint, run text, run_outcome text, words text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(words),'') <> '')
  then raise exception 'handoverFailed' using errcode='22023'; end if;
 update public.agent_handovers set state='returning', target_outcome=run_outcome,
  summary=case when run_outcome='completed' then left(btrim(words),8000) end, attempted_at=null
  where id=h and state='target' and target_run=run and target_outcome is null
  returning * into r;
 return r.id is not null;
end $$;
revoke all on function public.close_handover_target(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.close_handover_target(bigint,text,text,text) to service_role;

-- Lead's follow-up Run ended: its reply is Lead's message in the Conversation, the record people saw, kept once, and the
-- handover is done. It is closed here, not by close_conversation_run, since no person's message started it.
create function public.close_handover_follow_up(h bigint, run text, run_outcome text, reply text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers; existing public.conversations;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(reply),'') <> '')
  then raise exception 'handoverFailed' using errcode='22023'; end if;
 select * into r from public.agent_handovers where id=h for update;
 if r.id is null or r.state<>'follow_up' or r.follow_up_run is distinct from run then return false; end if;
 select * into existing from public.conversations where id=r.conversation_id;
 insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
  values(existing.company_id,r.conversation_id,run,run_outcome) on conflict do nothing;
 if run_outcome='completed' then
  insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
   values(existing.company_id,r.conversation_id,'agent',existing.agent_id,existing.agent_name,left(reply,200000),run)
   on conflict do nothing;
 end if;
 update public.agent_handovers set state='done', follow_up_outcome=run_outcome, closed_at=now() where id=h;
 return true;
end $$;
revoke all on function public.close_handover_follow_up(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.close_handover_follow_up(bigint,text,text,text) to service_role;

-- 20270214000000's run_tools, with the Lead's hand_to_agent.
create or replace function public.run_tools(c uuid, agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[
  case when public.may_use_lead_tools(c,agent,person) then 'create_agent' when public.may_ask_lead_for_agents(c,agent,person) then 'request_agent' end,
  case when public.may_hand_to_agent(c,agent,person) then 'hand_to_agent' end,
  case when public.may_tell_agent_rules(c,agent,person) then 'save_rule' when public.may_suggest_agent_rules(c,agent,person) then 'suggest_team_rule' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_draft' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_review' end,
  case when public.may_show_reply_cards(c,agent,person) then 'hand_over' end,
  case when public.may_show_reply_cards(c,agent,person) then 'ask_for_app' end],null);
$$;
