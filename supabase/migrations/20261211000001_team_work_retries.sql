-- Team-work retries (review of 20261211000000, ADR 0015).
--
-- A known send key keeps its first answer. A retried @person message (the same send key) stays the note it was, even
-- when its recipient has since been renamed or removed: it is never re-read as a message for the Agent.
--
-- A run's note is pinned at its first reservation. The engine compares the whole start request for one idempotency
-- key, so a retry must send exactly the instructions of the first attempt; the note the Member keeps may change in
-- between. conversation_run_notes keeps, per conversation and send key, the note the run was first reserved with (or
-- none), and every later attempt with that key reads it from there.
--
-- A queued turn whose start had an unknown outcome (the engine may have started it, its answer was lost) keeps its
-- reservation; the next claim returns that same turn on that same Connection, so it is asked again with the same key
-- and body until the engine says. Only a definite refusal fails the turn (fail_conversation_turn, unchanged).
-- Secrets. The detector also refuses a password, secret, token or key given with a quoted name (JSON, YAML, .env)
-- and a user and password inside an address. A note saved before keeps its row; only a change to it is checked again.
-- Nothing existing is rewritten.

create or replace function public.secret_like(t text) returns boolean language sql immutable set search_path='' as $$
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
   '(password|passwd|pwd|passphrase|secret|api[ _-]?key|access[ _-]?key|access[ _-]?token|auth[ _-]?token|refresh[ _-]?token|client[ _-]?secret|private[ _-]?key|token)["'']?\s*[:=]\s*["'']?[^\s"'']{4,}',
   '[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@',
   'bearer\s+[A-Za-z0-9._~+/-]{20,}',
   '(\u0643\u0644\u0645\u0629 \u0627\u0644\u0633\u0631|\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631|\u0627\u0644\u0628\u0627\u0633\u0648\u0631\u062f|\u0628\u0627\u0633\u0648\u0631\u062f)\s*[:=]\s*\S{4,}'
  ]),false);
$$;

create table public.conversation_run_notes (
 conversation_id uuid not null,
 send_key uuid not null,
 company_id uuid not null references public.companies(id),
 note text,
 pinned_at timestamptz not null default now(),
 primary key (conversation_id,send_key)
);
alter table public.conversation_run_notes enable row level security;
revoke all on public.conversation_run_notes from anon,authenticated,service_role;

-- The note a run is started with: the one pinned at its first reservation, pinned now from the sender's note when this
-- is the first.
create function public.pinned_run_note(conversation uuid, message_key uuid, c uuid, person uuid) returns text
language plpgsql security definer set search_path='' as $$
declare kept text;
begin
 insert into public.conversation_run_notes(conversation_id,send_key,company_id,note)
  values(conversation,message_key,c,(select n.note from public.member_notes n where n.company_id=c and n.person_id=person))
  on conflict (conversation_id,send_key) do nothing;
 select r.note into kept from public.conversation_run_notes r where r.conversation_id=conversation and r.send_key=message_key;
 return kept;
end $$;
revoke all on function public.pinned_run_note(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.reserve_conversation_turn(conversation uuid, c uuid, agent uuid, message_key uuid, message text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.conversations; chosen public.hermes_agents; queued public.conversation_queued_turns; noted public.conversation_notes; addressee record; writer text; pinned uuid;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if message is null or length(message) not between 1 and 200000 or message_key is null then raise exception 'conversationNotFound' using errcode='22023'; end if;
 -- Lock order: this Conversation's turns first, then the agents lock reserve_conversation_run takes.
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 select * into existing from public.conversations where id=conversation;
 if found and (existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is distinct from agent) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into chosen from public.hermes_agents where id=agent and company_id=c;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 -- A send key already answered keeps its answer, before anything is resolved again.
 select * into noted from public.conversation_notes n where n.conversation_id=conversation and n.send_key=message_key;
 if found then
  if noted.person_id<>auth.uid() then raise exception 'conversationNotFound' using errcode='P0002'; end if;
  return jsonb_build_object('state','note');
 end if;
 select * into queued from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=message_key;
 if found then
  if queued.person_id<>auth.uid() then raise exception 'conversationNotFound' using errcode='P0002'; end if;
  return jsonb_build_object('state',case when queued.failed_at is not null then 'failed' else 'queued' end);
 end if;
 select name into writer from public.people where id=auth.uid();
 -- A key already reserved for a run is a retry of that run, never a note.
 if not exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key) then
  select * into addressee from public.conversation_addressee(c,message);
  if addressee.person is not null then
   insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),agent,chosen.name) on conflict (id) do nothing;
   insert into public.conversation_notes(company_id,conversation_id,person_id,author_name,addressed_to,addressed_name,body,send_key)
    values(c,conversation,auth.uid(),coalesce(writer,''),addressee.person,addressee.name,message,message_key) on conflict (conversation_id,send_key) do nothing;
   return jsonb_build_object('state','note');
  end if;
 end if;
 if public.conversation_busy(conversation,message_key) then
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),agent,chosen.name) on conflict (id) do nothing;
  insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message) values(conversation,message_key,c,auth.uid(),agent,message);
  return jsonb_build_object('state','queued');
 end if;
 pinned:=public.reserve_conversation_run(conversation,c,agent,message_key,message);
 return jsonb_build_object('state','reserved','connection',pinned,'note',public.pinned_run_note(conversation,message_key,c,auth.uid()));
end $$;

-- As before, and: a waiting turn that still holds its own active reservation (its start's outcome is unknown) is
-- returned again on that reservation's Connection, after the same checks a retry of a direct send passes, so it is
-- asked again with the same idempotency key and the same pinned note.
create or replace function public.claim_conversation_turn(conversation uuid)
returns table(company uuid, agent uuid, person uuid, send_key uuid, message text, connection uuid, note text)
language plpgsql security definer set search_path='' as $$
declare turn public.conversation_queued_turns; linked public.hermes_connections; held public.conversation_run_reservations;
begin
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 if exists(select 1 from public.conversation_open_run(conversation)) then return; end if;
 select * into turn from public.conversation_queued_turns q where q.conversation_id=conversation and q.started_at is null and q.failed_at is null order by q.queued_at,q.send_key limit 1;
 if not found then return; end if;
 if exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.abandoned_at is null and r.send_key<>turn.send_key) then return; end if;
 if not exists(select 1 from public.members m where m.company_id=turn.company_id and m.person_id=turn.person_id and m.removed_at is null and m.role<>'viewer')
  or not exists(select 1 from public.conversations cv where cv.id=conversation and cv.agent_id=turn.agent_id) then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=turn.send_key and r.abandoned_at is null;
 if held.conversation_id is not null then select * into linked from public.hermes_connections h where h.id=held.connection_id;
 else select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=turn.agent_id and a.company_id=turn.company_id;
 end if;
 if linked.id is null or (linked.profile ~ '^co-[0-9a-f]{32}$' and linked.profile<>public.company_engine_profile(turn.company_id)) then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 if linked.profile ~ '^co-[0-9a-f]{32}$' and not public.company_profile_ready(turn.company_id) then return; end if;
 if held.conversation_id is null then
  insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
   values(conversation,turn.send_key,turn.company_id,linked.id,turn.person_id,turn.agent_id,turn.message,linked.profile)
   on conflict on constraint conversation_run_reservations_pkey do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null
    where public.conversation_run_reservations.abandoned_at is not null;
 end if;
 return query select turn.company_id,turn.agent_id,turn.person_id,turn.send_key,turn.message,linked.id,
  public.pinned_run_note(conversation,turn.send_key,turn.company_id,turn.person_id);
end $$;
