-- #23 The general channel. Every Company has one general channel from its first day; every active Member of a Company
-- that does not work alone is in it. Members write there; an Agent answers only when a message calls it by name, and
-- that message gets exactly one Run (one row of channel_runs) and at most one reply. A Viewer reads and cannot write.
-- Additive: three new tables, one trigger on companies, and move_company_profile also waits for a channel's open Runs.
-- The previous app version runs against it unchanged (a Company it inserts just gains its general channel row).
--
-- Not the Conversation machinery (lib/conversation-runs.mjs): no queued turns, notes, tools or stop. A channel Run is
-- one row per mentioning message, driven by lib/channel-runs.mjs through the four service-only steps below.

create table public.channels (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 kind text not null default 'general' check (kind in ('general')),
 created_at timestamptz not null default now(),
 unique (id, company_id)
);
create unique index channels_one_general on public.channels(company_id) where kind='general';

-- A Member's message, or an Agent's reply to the message that called it (reply_to: unique, so a mention gets at most
-- one reply). Append-only, as people saw it. agent_id has no foreign key: an Agent removed later leaves its replies.
create table public.channel_messages (
 id bigint generated always as identity primary key,
 company_id uuid not null,
 channel_id uuid not null,
 author text not null check (author in ('person','agent')),
 person_id uuid references public.people(id),
 agent_id uuid,
 author_name text not null,
 body text not null check (length(body) between 1 and 200000),
 send_key uuid,
 reply_to bigint references public.channel_messages(id),
 created_at timestamptz not null default now(),
 foreign key (channel_id, company_id) references public.channels(id, company_id),
 check ((author='person') = (person_id is not null and send_key is not null and reply_to is null)),
 check ((author='agent') = (reply_to is not null)),
 unique (channel_id, send_key),
 unique (reply_to)
);
create index channel_messages_order on public.channel_messages(channel_id, id);

-- The one Run of a message that calls an Agent, keyed by that message. Everything a start sends is pinned before the
-- first attempt (the session, the input, the Agent's instructions; the Connection at the first attempt), so every
-- attempt by anyone is the same engine request under the same idempotency key ('channel:' || message_id, derived in
-- lib/channel-runs.mjs, never stored), which the engine contract makes one Run.
create table public.channel_runs (
 message_id bigint primary key references public.channel_messages(id),
 company_id uuid not null,
 channel_id uuid not null,
 agent_id uuid references public.hermes_agents(id) on delete set null,
 agent_name text not null,
 session uuid not null,
 input text not null,
 instructions text,
 connection_id uuid references public.hermes_connections(id) on delete set null,
 attempts integer not null default 0 check (attempts >= 0),
 attempted_at timestamptz,
 run_id text unique check (run_id is null or attempts > 0),
 outcome text check (outcome in ('completed','failed','stopped','lost')),
 input_tokens bigint check (input_tokens >= 0),
 output_tokens bigint check (output_tokens >= 0),
 created_at timestamptz not null default now(),
 closed_at timestamptz,
 foreign key (channel_id, company_id) references public.channels(id, company_id),
 check ((outcome is null) = (closed_at is null)),
 check ((input_tokens is null) = (output_tokens is null))
);
create index channel_runs_open on public.channel_runs(message_id) where outcome is null;
create index channel_runs_connection on public.channel_runs(connection_id) where outcome is null;

-- Membership is derived, never stored: the general channel holds every active Member who is a person (a legacy role
-- Agent is not) of a Company that does not work alone (not answered yet counts as team, as the sidebar does). So a
-- Member who joins later (an invitation claimed, first run, a direct insert, a restore) is in at once, a removed one is
-- out, and an alone Company's channel has nobody in it: nobody sees or writes it. When it turns team its channel
-- appears with its history.
create function public.channel_member(ch uuid, person uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.channels k
  join public.companies co on co.id=k.company_id
  join public.members m on m.company_id=k.company_id and m.person_id=person
  where k.id=ch and k.kind='general' and co.work_mode is distinct from 'alone'
   and m.removed_at is null and m.agent_role is null
   and not exists(select 1 from public.agents a where a.id=m.person_id));
$$;
revoke all on function public.channel_member(uuid,uuid) from public,anon,authenticated,service_role;

-- What the read policies ask: whether the caller is in the channel. It answers nothing about anyone else.
create function public.in_channel(ch uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.channel_member(ch, auth.uid());
$$;
revoke all on function public.in_channel(uuid) from public,anon,service_role;
grant execute on function public.in_channel(uuid) to authenticated;

-- Who is in the channel now, for a caller who is in it: Owners first, then Managers, Contributors and Viewers.
create function public.channel_members(ch uuid) returns table(person uuid, name text, role public.member_role)
language sql stable security definer set search_path='' as $$
 select m.person_id, p.name, m.role from public.channels k
  join public.members m on m.company_id=k.company_id join public.people p on p.id=m.person_id
 where k.id=ch and public.in_channel(ch) and public.channel_member(ch, m.person_id)
 order by m.role, p.name, m.person_id;
$$;
revoke all on function public.channel_members(uuid) from public,anon,service_role;
grant execute on function public.channel_members(uuid) to authenticated;

create function public.add_general_channel() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.channels(company_id, kind) values (new.id, 'general') on conflict (company_id) where kind='general' do nothing;
 return null;
end $$;
revoke all on function public.add_general_channel() from public,anon,authenticated,service_role;
create trigger companies_general_channel after insert on public.companies for each row execute function public.add_general_channel();
insert into public.channels(company_id, kind) select id, 'general' from public.companies
 on conflict (company_id) where kind='general' do nothing;

-- The Agent a message calls: "@" and an Agent's name, in any case, after the start, a space or a punctuation mark and
-- before the end, a space or a punctuation mark (Arabic ، ؛ ؟ count). Only an Agent the sender sees (#15) can be
-- called. Several: the earliest wins; at one place the longest name ("@Lead Writer" over "@Lead"); the same name: the
-- main Agent, then by id. A Member's name, or nothing, calls no Agent: null.
create function public.channel_mention(c uuid, person uuid, message text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare a record; t text := lower(message); best uuid; best_at int; best_len int; found_at int; from_at int;
begin
 for a in select h.id, '@'||lower(btrim(h.name)) handle from public.hermes_agents h
   where h.company_id=c and btrim(h.name)<>'' and public.agent_visible_to(c, person, h.id) order by h.is_default desc, h.id loop
  from_at := 1;
  loop
   found_at := strpos(substr(t, from_at), a.handle); exit when found_at = 0; found_at := found_at + from_at - 1;
   if (found_at = 1 or substr(t, found_at-1, 1) ~ '[[:space:][:punct:]،؛؟]')
      and (found_at + length(a.handle) > length(t) or substr(t, found_at+length(a.handle), 1) ~ '[[:space:][:punct:]،؛؟]') then
    if best is null or found_at < best_at or (found_at = best_at and length(a.handle) > best_len) then
     best := a.id; best_at := found_at; best_len := length(a.handle);
    end if;
    exit;
   end if;
   from_at := found_at + 1;
  end loop;
 end loop;
 return best;
end $$;
revoke all on function public.channel_mention(uuid,uuid,text) from public,anon,authenticated,service_role;

-- A Member's message. The author is the signed-in person (ADR 0015). A message that calls an Agent the sender sees gets
-- its one Run row in the same transaction, with the Agent's input ('<first name>: <message>': the message alone, not the
-- talk around it) and instructions pinned. A repeated send key returns the sender's first message and creates nothing.
-- Refusals: P0002 channelNotFound (not in it, unknown, alone Company), 42501 channelNotAllowed (a Viewer), 22023
-- channelFailed (empty, over 20,000 characters, or a key another person used).
create function public.post_channel_message(ch uuid, message_key uuid, message text) returns bigint
language plpgsql security definer set search_path='' as $$
declare k public.channels; saved bigint; writer text; chosen public.hermes_agents;
begin
 select * into k from public.channels where id=ch;
 if k.id is null or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.conversation_can_write(k.company_id) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if message_key is null or message is null or btrim(message)='' or length(message) > 20000 then raise exception 'channelFailed' using errcode='22023'; end if;
 select coalesce(btrim(name),'') into writer from public.people where id=auth.uid();
 insert into public.channel_messages(company_id, channel_id, author, person_id, author_name, body, send_key)
  values (k.company_id, ch, 'person', auth.uid(), coalesce(writer,''), message, message_key)
  on conflict (channel_id, send_key) do nothing returning id into saved;
 if saved is null then
  select id into saved from public.channel_messages where channel_id=ch and send_key=message_key and person_id=auth.uid();
  if saved is null then raise exception 'channelFailed' using errcode='22023'; end if;
  return saved;
 end if;
 select * into chosen from public.hermes_agents where id=public.channel_mention(k.company_id, auth.uid(), message);
 if chosen.id is not null then
  insert into public.channel_runs(message_id, company_id, channel_id, agent_id, agent_name, session, input, instructions)
   values (saved, k.company_id, ch, chosen.id, chosen.name, md5(ch::text||':'||chosen.id::text)::uuid,
           split_part(coalesce(writer,''),' ',1)||': '||message, nullif(btrim(chosen.instructions),''));
 end if;
 return saved;
end $$;
revoke all on function public.post_channel_message(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.post_channel_message(uuid,uuid,text) to authenticated;

-- The Run lifecycle, service_role only, reached only from lib/channel-runs.mjs. Each step is one guarded change of the
-- row under its lock, so a retry, a second worker or a reader at the same moment changes nothing twice. A fresh Run
-- belongs to its sender's request for one minute, and a start whose answer is not in yet to that attempt for thirty
-- seconds (an engine answers a start within twenty): the sender's own request (just_message, also a resend of the same
-- message) may drive it at once; after that anyone does. So a start in flight is not sent again every second.
create function public.channel_runs_due(just_channel uuid default null, just_message bigint default null)
returns table(message bigint, run text, connection uuid, address text, profile text, state text)
language sql stable security definer set search_path='' as $$
 select r.message_id, r.run_id, r.connection_id, h.address, h.profile, h.state
 from public.channel_runs r left join public.hermes_connections h on h.id=r.connection_id
 where r.outcome is null
  and (just_channel is null or r.channel_id=just_channel) and (just_message is null or r.message_id=just_message)
  and (r.run_id is not null or r.message_id=just_message
   or (r.attempts = 0 and r.created_at < now()-interval '1 minute') or (r.attempts > 0 and r.attempted_at < now()-interval '30 seconds'))
 order by r.message_id limit 500;
$$;

-- One attempt to start: what to send, or no row when there is nothing to do now. The lock a profile move takes is taken
-- first (the order move_company_profile takes them in), so no move passes between pinning a Connection and the move's
-- check for open Runs on it.
create function public.begin_channel_start(message bigint)
returns table(attempt integer, company uuid, connection uuid, session uuid, input text, instructions text)
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs; linked public.hermes_connections;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.channel_runs where message_id=message for update;
 if r.message_id is null or r.outcome is not null or r.run_id is not null then return; end if;
 -- Never started: given up after ten minutes. May have started: given up after a day, as ADR 0015 gives up a start
 -- whose answer was lost.
 if r.attempts = 0 and r.created_at < now()-interval '10 minutes' then perform public.close_channel_run(message,null,'failed',null,null,null); return; end if;
 if r.attempts > 0 and r.created_at < now()-interval '1 day' then perform public.close_channel_run(message,null,'lost',null,null,null); return; end if;
 if r.attempts = 0 then
  select a.connection_id into r.connection_id from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id;
  if r.connection_id is null then perform public.close_channel_run(message,null,'failed',null,null,null); return; end if;
 elsif r.connection_id is null then
  perform public.close_channel_run(message,null,'lost',null,null,null); return;
 end if;
 select * into linked from public.hermes_connections where id=r.connection_id;
 -- ADR 0014: a Company profile serves its own Company, and no Run starts while its tools are pending. Waiting returns
 -- nothing; the deadlines above end the wait.
 if linked.profile ~ '^co-[0-9a-f]{32}$' and (linked.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 update public.channel_runs set attempts=attempts+1, attempted_at=now(), connection_id=r.connection_id
  where message_id=message returning attempts into r.attempts;
 return query select r.attempts, r.company_id, r.connection_id, r.session, r.input, r.instructions;
end $$;

-- The engine's answer to attempt `attempt`: a run id is recorded once; null (refused) ends the Run as failed only for
-- the first attempt while no later one was made, since only a first start can prove nothing started (ADR 0015). An
-- unknown answer is not reported: the row stays attempted, and the next pass asks again with the same key and body.
create function public.answer_channel_start(message bigint, attempt integer, run text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs;
begin
 select * into r from public.channel_runs where message_id=message for update;
 if r.message_id is null or r.outcome is not null then return false; end if;
 if run is not null then
  if r.run_id is not null then return r.run_id = run; end if;
  update public.channel_runs set run_id=run where message_id=message; return true;
 end if;
 if attempt = 1 and r.attempts = 1 and r.run_id is null then
  return public.close_channel_run(message, null, 'failed', null, null, null);
 end if;
 return false;
end $$;

-- Ends a Run once: its outcome and usage and, when it completed, the reply posted in the channel in the same
-- transaction. A second closer finds it ended and changes nothing.
create function public.close_channel_run(message bigint, run text, run_outcome text, reply text, used_input bigint, used_output bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.channel_runs;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(reply),'') <> '')
  or (used_input is null) <> (used_output is null) then
  raise exception 'channelFailed' using errcode='22023'; end if;
 update public.channel_runs set outcome=run_outcome, closed_at=now(), input_tokens=used_input, output_tokens=used_output
  where message_id=message and outcome is null and run_id is not distinct from run returning * into r;
 if r.message_id is null then return false; end if;
 if run_outcome='completed' then
  insert into public.channel_messages(company_id, channel_id, author, agent_id, author_name, body, reply_to)
   values (r.company_id, r.channel_id, 'agent', r.agent_id, r.agent_name, reply, message) on conflict (reply_to) do nothing;
 end if;
 return true;
end $$;

revoke all on function public.channel_runs_due(uuid,bigint) from public,anon,authenticated;
revoke all on function public.begin_channel_start(bigint) from public,anon,authenticated;
revoke all on function public.answer_channel_start(bigint,integer,text) from public,anon,authenticated;
revoke all on function public.close_channel_run(bigint,text,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.channel_runs_due(uuid,bigint), public.begin_channel_start(bigint),
 public.answer_channel_start(bigint,integer,text), public.close_channel_run(bigint,text,text,text,bigint,bigint) to service_role;

-- Reads: channel members only (a Viewer reads; writing is post_channel_message's question). No client writes a table.
alter table public.channels enable row level security;
alter table public.channel_messages enable row level security;
alter table public.channel_runs enable row level security;
create policy channels_read on public.channels for select to authenticated using (public.in_channel(id));
create policy channel_messages_read on public.channel_messages for select to authenticated using (public.in_channel(channel_id));
create policy channel_runs_read on public.channel_runs for select to authenticated using (public.in_channel(channel_id));
revoke all on public.channels, public.channel_messages, public.channel_runs from anon, authenticated, service_role;
grant select on public.channels to authenticated;
-- A sender's key stays theirs.
grant select (id, company_id, channel_id, author, person_id, agent_id, author_name, body, reply_to, created_at) on public.channel_messages to authenticated;
-- A Run's state only: never what was sent, its Connection or its engine run id.
grant select (message_id, company_id, channel_id, agent_id, agent_name, outcome, created_at, closed_at) on public.channel_runs to authenticated;

create function public.refuse_channel_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'channelAppendOnly' using errcode='42501'; end $$;
revoke all on function public.refuse_channel_change() from public,anon,authenticated,service_role;
create trigger channel_messages_append_only before update or delete on public.channel_messages
 for each row execute function public.refuse_channel_change();

-- A profile move also waits for every open channel Run on a Connection it would replace: such a Run's Connection is
-- pinned, and removing it would lose the Run. The rest is 20261210000002's move unchanged.
create or replace function public.move_company_profile(c uuid, bundled_address text, bundled_key text, bundled_version text, bundled_features text[]) returns integer
language plpgsql security definer set search_path='' as $$
declare first_owner uuid; olds uuid[]; old uuid; linked uuid; agent uuid; moved integer:=0;
begin
 if public.hermes_profile_address(bundled_address) is null or coalesce(bundled_key,'')='' or not ('run_submission'=any(coalesce(bundled_features,'{}'))) then raise exception 'hermesAgentFailed' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if not public.company_profile_ready(c) then return 0; end if;
 select m.person_id into first_owner from public.members m where m.company_id=c and m.role='owner' and m.removed_at is null order by m.person_id limit 1;
 if first_owner is null then return 0; end if;
 olds:=array(select distinct a.connection_id from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id
  where a.company_id=c and h.profile<>public.company_engine_profile(c) and public.is_bundled_connection(h.id));
 if exists(select 1 from public.conversation_run_reservations r where r.connection_id=any(olds) and r.abandoned_at is null)
  or exists(select 1 from public.channel_runs r where r.connection_id=any(olds) and r.outcome is null)
  or exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   join public.hermes_agents a on a.id=cv.agent_id and a.company_id=cv.company_id
   where a.company_id=c and a.connection_id=any(olds) and m.created_at>now()-interval '5 minutes')
  or exists(select 1 from public.conversation_messages m join public.conversations cv on cv.id=m.conversation_id
   join public.hermes_agents a on a.id=cv.agent_id and a.company_id=cv.company_id
   where a.company_id=c and a.connection_id=any(olds) and m.author='person'
    and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
    and not exists(select 1 from public.conversation_usage u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)) then
  return 0;
 end if;
 foreach old in array olds loop
  insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state,version,features)
   values(c,first_owner,bundled_address,public.company_engine_profile(c),bundled_key,'connected',bundled_version,bundled_features) returning id into linked;
  for agent in update public.hermes_agents set connection_id=linked where company_id=c and connection_id=old returning id loop
   insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
    values(c,first_owner,(select name from public.people where id=first_owner),agent,'MOVE_COMPANY_PROFILE',jsonb_build_object('connection_id',linked,'from_connection_id',old));
   moved:=moved+1;
  end loop;
  delete from public.hermes_connections h where h.id=old and not exists(select 1 from public.hermes_agents a where a.connection_id=old)
   and not exists(select 1 from public.conversation_run_reservations r where r.connection_id=old and r.abandoned_at is null);
 end loop;
 return moved;
end $$;
revoke all on function public.move_company_profile(uuid,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.move_company_profile(uuid,text,text,text,text[]) to service_role;
