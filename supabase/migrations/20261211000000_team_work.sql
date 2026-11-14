-- Team work in Conversations (Omar's rules of 2026-11-13; ideas from OpenClaw, MIT, no code copied).
--
-- A Conversation stays private to the person who started it (GLOSSARY): nobody else reads or writes there, so "another
-- member writes while the Agent is busy" is today a person writing again while their own run is still open. The run
-- layer handles both the same way:
--  * Turns. A message sent while the Conversation's Agent is busy (an open run, an active reservation, or turns already
--    waiting) is queued as its sender's own next turn, never merged into the running one. When the open run ends, the
--    worker or a reader starts the oldest waiting turn on the engine and records it as an ordinary message of its own
--    sender (the queue row keeps who sent it; nothing is taken from a request). A turn the engine refuses to start is
--    marked failed and its sender sends again.
--  * Stop. Only the person who started the open run, or a Manager or Owner of the Company, may stop it.
--  * Addressed messages. A message that starts with @<name of an active Member> is for that person: it is kept in the
--    Conversation's record as a note and no run starts. Only messages sent to the Agent wake it.
--  * Member notes. Each Member keeps one short note of preferences per Company (at most 4,000 characters, nothing that
--    looks like a key, token or password). Only that Member reads or writes it; it goes to the engine with that Member's
--    own runs (as the run's instructions), never into the Company's memory.
-- Every author here is the signed-in person (auth.uid()) or, for a queued turn, the sender recorded when it was queued.
-- Nothing existing is rewritten; the previous app version keeps reserve_conversation_run and send_conversation_message.

-- What looks like a secret. lib/secret-text.mjs holds the same patterns for the form (tests/secret-text.test.mjs keeps
-- the two lists equal).
create function public.secret_like(t text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(t ~ any(array[
   'sk-[A-Za-z0-9_-]{20,}',
   '(gtmw_agt_|gtmw_run_|agt_)[A-Za-z0-9_-]{16,}',
   'gh[pousr]_[A-Za-z0-9]{30,}',
   'github_pat_[A-Za-z0-9_]{20,}',
   'xox[abprs]-[A-Za-z0-9-]{10,}',
   'AKIA[0-9A-Z]{16}',
   'AIza[0-9A-Za-z_-]{35}',
   '-----BEGIN [A-Z ]*PRIVATE KEY-----',
   'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
  ]) or t ~* any(array[
   '(password|passwd|pwd|secret|api[ _-]?key|access[ _-]?token|auth[ _-]?token|token)\s*[:=]\s*\S{4,}',
   'bearer\s+[A-Za-z0-9._~+/-]{20,}',
   '(\u0643\u0644\u0645\u0629 \u0627\u0644\u0633\u0631|\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631|\u0627\u0644\u0628\u0627\u0633\u0648\u0631\u062f|\u0628\u0627\u0633\u0648\u0631\u062f)\s*[:=]\s*\S{4,}'
  ]),false);
$$;
revoke all on function public.secret_like(text) from public,anon;
grant execute on function public.secret_like(text) to authenticated,service_role;

-- One note per Member per Company.
create table public.member_notes (
 company_id uuid not null,
 person_id uuid not null,
 note text not null,
 updated_at timestamptz not null default now(),
 primary key (company_id,person_id),
 foreign key (company_id,person_id) references public.members(company_id,person_id) on delete cascade,
 constraint member_note_length check (length(note) between 1 and 4000),
 constraint member_note_no_secret check (not public.secret_like(note))
);
alter table public.member_notes enable row level security;
create policy member_notes_own on public.member_notes for all to authenticated
 using (person_id=auth.uid() and public.is_member(company_id)) with check (person_id=auth.uid() and public.is_member(company_id));
revoke all on public.member_notes from anon,authenticated,service_role;
grant select,insert,update,delete on public.member_notes to authenticated;

-- The form saves through this, as the signed-in person (RLS applies); an empty note removes it. Refusals carry a key.
create function public.save_member_note(c uuid, note text) returns text language plpgsql security invoker set search_path='' as $$
declare kept text := btrim(coalesce(note,''));
begin
 if auth.uid() is null or not public.is_member(c) then raise exception 'memberNoteNotAllowed' using errcode='42501'; end if;
 if kept='' then delete from public.member_notes where company_id=c and person_id=auth.uid(); return ''; end if;
 if length(kept)>4000 then raise exception 'memberNoteTooLong' using errcode='22001'; end if;
 if public.secret_like(kept) then raise exception 'memberNoteSecret' using errcode='22023'; end if;
 insert into public.member_notes(company_id,person_id,note) values(c,auth.uid(),kept)
  on conflict (company_id,person_id) do update set note=excluded.note,updated_at=now();
 return kept;
end $$;
revoke all on function public.save_member_note(uuid,text) from public,anon,service_role;
grant execute on function public.save_member_note(uuid,text) to authenticated;

-- Turns waiting for the Agent, in the order they were sent. A row is the sender's own message until it starts; once
-- started it is an ordinary conversation_messages row with the same send key.
create table public.conversation_queued_turns (
 conversation_id uuid not null,
 send_key uuid not null,
 company_id uuid not null references public.companies(id),
 person_id uuid not null references public.people(id),
 agent_id uuid not null,
 message text not null check (length(message) between 1 and 200000),
 queued_at timestamptz not null default clock_timestamp(),
 started_at timestamptz,
 failed_at timestamptz,
 primary key (conversation_id,send_key),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id)
);
create index conversation_queued_turns_waiting on public.conversation_queued_turns(conversation_id,queued_at) where started_at is null and failed_at is null;
alter table public.conversation_queued_turns enable row level security;
create policy conversation_queued_turns_read on public.conversation_queued_turns for select to authenticated using (exists(select 1 from public.conversations c where c.id=conversation_id and c.company_id=conversation_queued_turns.company_id and c.person_id=auth.uid() and public.is_member(c.company_id)));
revoke all on public.conversation_queued_turns from anon,authenticated,service_role;
grant select on public.conversation_queued_turns to authenticated;

-- Messages addressed to a person: part of the record as people saw it, append-only, and never sent to the engine.
create table public.conversation_notes (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 conversation_id uuid not null,
 person_id uuid not null references public.people(id),
 author_name text not null,
 addressed_to uuid not null references public.people(id),
 addressed_name text not null,
 body text not null check (length(body) between 1 and 200000),
 send_key uuid not null,
 created_at timestamptz not null default now(),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id),
 unique(conversation_id,send_key)
);
alter table public.conversation_notes enable row level security;
create policy conversation_notes_read on public.conversation_notes for select to authenticated using (exists(select 1 from public.conversations c where c.id=conversation_id and c.company_id=conversation_notes.company_id and c.person_id=auth.uid() and public.is_member(c.company_id)));
revoke all on public.conversation_notes from anon,authenticated,service_role;
grant select on public.conversation_notes to authenticated;
create trigger conversation_notes_append_only before update or delete on public.conversation_notes for each row execute function public.refuse_conversation_change();

-- The active Member a message is addressed to: it starts with @ and that Member's whole name, then a space, a
-- punctuation mark or its end. The longest matching name wins; anything else is for the Agent. A Member that is an
-- Agent (a legacy role Agent, or one holding an Agent role key) and a name one of the Company's Agents carries are
-- never a person here: "@Lead" is still sent to the Agent.
create function public.conversation_addressee(c uuid, message text) returns table(person uuid, name text) language sql stable security definer set search_path='' as $$
 select p.id,p.name from public.members m join public.people p on p.id=m.person_id, lateral (select ltrim(message) as text) t
 where m.company_id=c and m.removed_at is null and length(btrim(p.name))>0
  and m.agent_role is null and not exists(select 1 from public.agents a where a.id=m.person_id)
  and not exists(select 1 from public.hermes_agents h where h.company_id=c and lower(h.name)=lower(p.name))
  and lower(left(t.text,length(p.name)+1))='@'||lower(p.name)
  and (length(t.text)=length(p.name)+1 or substr(t.text,length(p.name)+2,1) ~ '[[:space:][:punct:]،؛؟]')
 order by length(p.name) desc,p.id limit 1;
$$;
revoke all on function public.conversation_addressee(uuid,text) from public,anon,authenticated,service_role;

-- The run of a Conversation that has not ended: a person's message with no reply and no recorded outcome.
create function public.conversation_open_run(conversation uuid) returns table(message bigint, run text, person uuid, author_name text) language sql stable security definer set search_path='' as $$
 select m.id,m.run_id,m.person_id,m.author_name from public.conversation_messages m
 where m.conversation_id=conversation and m.author='person'
  and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
  and not exists(select 1 from public.conversation_usage u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)
 order by m.id desc limit 1;
$$;
revoke all on function public.conversation_open_run(uuid) from public,anon,authenticated,service_role;

-- Whether a new message must wait: a run is open, another send is reserved, or turns are already waiting.
create function public.conversation_busy(conversation uuid, except_key uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversation_open_run(conversation))
  or exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.abandoned_at is null and r.send_key<>except_key)
  or exists(select 1 from public.conversation_queued_turns q where q.conversation_id=conversation and q.started_at is null and q.failed_at is null and q.send_key<>except_key);
$$;
revoke all on function public.conversation_busy(uuid,uuid) from public,anon,authenticated,service_role;

-- The sender's one entry point. Under the Conversation's lock it decides what this message is: a note to a person
-- (stored, no run), a turn that waits (stored in the queue), or a run to start now (reserved as before, with the
-- sender's own note for the engine). A repeated send key answers the same way and stores nothing twice.
create function public.reserve_conversation_turn(conversation uuid, c uuid, agent uuid, message_key uuid, message text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.conversations; chosen public.hermes_agents; queued public.conversation_queued_turns; addressee record; writer text; pinned uuid; kept text;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if message is null or length(message) not between 1 and 200000 or message_key is null then raise exception 'conversationNotFound' using errcode='22023'; end if;
 -- Lock order: this Conversation's turns first, then the agents lock reserve_conversation_run takes.
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 select * into existing from public.conversations where id=conversation;
 if found and (existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is distinct from agent) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into chosen from public.hermes_agents where id=agent and company_id=c;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select name into writer from public.people where id=auth.uid();
 select * into addressee from public.conversation_addressee(c,message);
 if addressee.person is not null then
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),agent,chosen.name) on conflict (id) do nothing;
  insert into public.conversation_notes(company_id,conversation_id,person_id,author_name,addressed_to,addressed_name,body,send_key)
   values(c,conversation,auth.uid(),coalesce(writer,''),addressee.person,addressee.name,message,message_key) on conflict (conversation_id,send_key) do nothing;
  return jsonb_build_object('state','note');
 end if;
 select * into queued from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=message_key;
 if found then
  if queued.person_id<>auth.uid() then raise exception 'conversationNotFound' using errcode='P0002'; end if;
  return jsonb_build_object('state',case when queued.failed_at is not null then 'failed' else 'queued' end);
 end if;
 if public.conversation_busy(conversation,message_key) then
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),agent,chosen.name) on conflict (id) do nothing;
  insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message) values(conversation,message_key,c,auth.uid(),agent,message);
  return jsonb_build_object('state','queued');
 end if;
 pinned:=public.reserve_conversation_run(conversation,c,agent,message_key,message);
 select n.note into kept from public.member_notes n where n.company_id=c and n.person_id=auth.uid();
 return jsonb_build_object('state','reserved','connection',pinned,'note',kept);
end $$;
revoke all on function public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text) to authenticated;

-- The worker's and a reader's list of Conversations with turns waiting.
create function public.queued_conversations(just uuid default null) returns table(conversation uuid) language sql stable security definer set search_path='' as $$
 select distinct q.conversation_id from public.conversation_queued_turns q
 where q.started_at is null and q.failed_at is null and (just is null or q.conversation_id=just) limit 500;
$$;
revoke all on function public.queued_conversations(uuid) from public,anon,authenticated;
grant execute on function public.queued_conversations(uuid) to service_role;

-- Takes the oldest waiting turn of a Conversation whose Agent is free, and reserves its run for its own sender, with
-- the same checks as a direct send (the Agent is still the Conversation's, the sender may still write, the profile is
-- the Company's and its tools are applied). Returns nothing while the Agent is busy or the profile is not ready.
create function public.claim_conversation_turn(conversation uuid)
returns table(company uuid, agent uuid, person uuid, send_key uuid, message text, connection uuid, note text)
language plpgsql security definer set search_path='' as $$
declare turn public.conversation_queued_turns; linked public.hermes_connections;
begin
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 if exists(select 1 from public.conversation_open_run(conversation))
  or exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.abandoned_at is null) then return; end if;
 select * into turn from public.conversation_queued_turns q where q.conversation_id=conversation and q.started_at is null and q.failed_at is null order by q.queued_at,q.send_key limit 1;
 if not found then return; end if;
 if not exists(select 1 from public.members m where m.company_id=turn.company_id and m.person_id=turn.person_id and m.removed_at is null and m.role<>'viewer')
  or not exists(select 1 from public.conversations cv where cv.id=conversation and cv.agent_id=turn.agent_id) then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=turn.agent_id and a.company_id=turn.company_id;
 if linked.id is null or (linked.profile ~ '^co-[0-9a-f]{32}$' and linked.profile<>public.company_engine_profile(turn.company_id)) then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 if linked.profile ~ '^co-[0-9a-f]{32}$' and not public.company_profile_ready(turn.company_id) then return; end if;
 insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
  values(conversation,turn.send_key,turn.company_id,linked.id,turn.person_id,turn.agent_id,turn.message,linked.profile)
  on conflict on constraint conversation_run_reservations_pkey do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null
   where public.conversation_run_reservations.abandoned_at is not null;
 return query select turn.company_id,turn.agent_id,turn.person_id,turn.send_key,turn.message,linked.id,
  (select n.note from public.member_notes n where n.company_id=turn.company_id and n.person_id=turn.person_id);
end $$;
revoke all on function public.claim_conversation_turn(uuid) from public,anon,authenticated;
grant execute on function public.claim_conversation_turn(uuid) to service_role;

-- Records a started turn as its own sender's message, under the same rules as send_conversation_message: the run is
-- accepted only while its reservation is active and its Connection is the one it started on and the Agent's of now;
-- otherwise the turn is marked failed (its sender sends again). Returns whether a message was stored.
create function public.record_conversation_turn(conversation uuid, message_key uuid, run text, started_on uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare turn public.conversation_queued_turns; held public.conversation_run_reservations; chosen public.hermes_agents; writer text; saved bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into turn from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=message_key;
 if not found or run is null then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if turn.started_at is not null then return false; end if;
 select * into chosen from public.hermes_agents a where a.id=turn.agent_id and a.company_id=turn.company_id;
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key;
 if chosen.id is null or held.conversation_id is null or held.abandoned_at is not null or started_on is null or held.connection_id<>started_on or held.connection_id is distinct from chosen.connection_id then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=message_key;
  delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null;
  return false;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation_run:'||run,0));
 if exists(select 1 from public.conversation_messages m where m.author='person' and m.run_id=run and m.conversation_id<>conversation) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select name into writer from public.people where id=turn.person_id;
 insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
  values(turn.company_id,conversation,'person',turn.person_id,coalesce(writer,''),turn.message,message_key,run) on conflict do nothing returning id into saved;
 delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key;
 update public.conversation_queued_turns q set started_at=now() where q.conversation_id=conversation and q.send_key=message_key;
 return saved is not null;
end $$;
revoke all on function public.record_conversation_turn(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.record_conversation_turn(uuid,uuid,text,uuid) to service_role;

-- A turn the engine would not start: marked failed and its reservation released, so the next turn can go.
create function public.fail_conversation_turn(conversation uuid, message_key uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=message_key and q.started_at is null;
 delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null;
end $$;
revoke all on function public.fail_conversation_turn(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_conversation_turn(uuid,uuid) to service_role;

-- Stop: the open run of a Conversation in this Company and its Agent's Connection, for the person who started that
-- run or a Manager or Owner of the Company. Anyone else is refused; someone outside the Company finds nothing.
create function public.conversation_stop_target(conversation uuid, c uuid) returns table(run text, connection uuid)
language plpgsql stable security definer set search_path='' as $$
declare running record; linked uuid;
begin
 if auth.uid() is null or not public.is_member(c) or not exists(select 1 from public.conversations cv where cv.id=conversation and cv.company_id=c) then
  raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into running from public.conversation_open_run(conversation);
 if running.run is null then raise exception 'conversationNothingToStop' using errcode='P0002'; end if;
 if running.person<>auth.uid() and not public.can_manage_company(c) then raise exception 'conversationStopNotAllowed' using errcode='42501'; end if;
 select a.connection_id into linked from public.conversations cv join public.hermes_agents a on a.id=cv.agent_id and a.company_id=cv.company_id where cv.id=conversation;
 return query select running.run,linked;
end $$;
revoke all on function public.conversation_stop_target(uuid,uuid) from public,anon,service_role;
grant execute on function public.conversation_stop_target(uuid,uuid) to authenticated;

-- Who the Agent is working for in a Conversation, for everyone who reads it.
create function public.conversation_working_for(conversation uuid) returns table(person uuid, name text) language sql stable security definer set search_path='' as $$
 select o.person,o.author_name from public.conversation_open_run(conversation) o
 where exists(select 1 from public.conversations cv where cv.id=conversation and cv.person_id=auth.uid() and public.is_member(cv.company_id));
$$;
revoke all on function public.conversation_working_for(uuid) from public,anon,service_role;
grant execute on function public.conversation_working_for(uuid) to authenticated;

-- A reservation the worker abandons also leaves its queued turn free to be claimed again (abandon_conversation_reservations
-- is unchanged: claim_conversation_turn re-reserves an abandoned reservation with the same send key, so the engine's
-- idempotency key keeps it one run).
