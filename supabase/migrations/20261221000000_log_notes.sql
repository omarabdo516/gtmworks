-- #22 Notes and mentions in the log. A note is a Card comment (work_comments), which the Company log already copies as
-- a 'note' row. Its writer may change its text for five minutes, from the Card or from the Activity log; then it is
-- locked, and nobody ever deletes one. A note that names Members puts one "Waiting on you" item before each of them; one
-- that calls an Agent the writer sees gets exactly one Run (one row of note_runs), and the Agent's reply is written into
-- the log under the note. A Viewer writes no note (work_comment_insert already asks work_can_edit).
-- Additive: a column on work_comments and one on waiting_items, one new table and triggers on work_comments. The
-- previous app version runs against it unchanged: it never changes or deletes a comment, and waiting_list keeps its shape
-- (the app reads the note a mention opens from the reader's own waiting_items row).

alter table public.work_comments add column edited_at timestamptz;

-- A note changes only in its text, only by its writer (the signed-in person) and only in its first five minutes. Every
-- role is held to it, the service role and the database owner included. Saving the same text again changes nothing.
create function public.guard_note_edit() returns trigger language plpgsql set search_path='' as $$
begin
 if auth.uid() is distinct from old.author_id then raise exception 'noteNotYours' using errcode='42501'; end if;
 if now() >= old.created_at + interval '5 minutes' then raise exception 'noteLocked' using errcode='42501'; end if;
 if to_jsonb(new) - 'body' - 'edited_at' <> to_jsonb(old) - 'body' - 'edited_at'
  or btrim(coalesce(new.body,''), E' \t\r\n') = '' or length(new.body) > 20000 then
  raise exception 'noteFailed' using errcode='22023'; end if;
 if new.body = old.body then return null; end if;
 new.edited_at := now();
 return new;
end $$;
revoke all on function public.guard_note_edit() from public,anon,authenticated,service_role;
create trigger work_comments_note_edit before update on public.work_comments for each row execute function public.guard_note_edit();

create function public.refuse_note_delete() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'noteIsPermanent' using errcode='42501'; end $$;
revoke all on function public.refuse_note_delete() from public,anon,authenticated,service_role;
create trigger work_comments_never_deleted before delete on public.work_comments for each row execute function public.refuse_note_delete();

-- An edit is not a second comment: the Card's activity (and its webhook) records a comment once, when it is written.
drop trigger work_audit on public.work_comments;
create trigger work_audit after insert on public.work_comments for each row execute function public.work_audit();

-- The log row of a note follows its text, marked with when it was edited.
create function public.log_note_edit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.company_log set body=new.body, details=details || jsonb_build_object('edited_at',new.edited_at)
  where source='work_comments' and source_id=new.id;
 return null;
end $$;
revoke all on function public.log_note_edit() from public,anon,authenticated,service_role;
create trigger work_comments_log_edit after update on public.work_comments for each row execute function public.log_note_edit();

-- The log stays permanent with one exception: a note's row takes its note's current text and edit time, and nothing
-- else about it changes. Every other change and every delete is refused as before.
create or replace function public.refuse_log_change() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.source='work_comments' and to_jsonb(new) - 'body' - 'details' = to_jsonb(old) - 'body' - 'details'
  and exists(select 1 from public.work_comments w where w.id=old.source_id and w.edited_at is not null
   and new.body is not distinct from w.body and new.details = old.details || jsonb_build_object('edited_at',w.edited_at)) then
  return new;
 end if;
 raise exception 'logIsPermanent' using errcode='42501';
end;
$$;

-- The writer changes a note's text; the Card and the Activity log both call it. Refusals: 42501 noteNotAllowed (a
-- Viewer, or not a Member), P0002 noteNotFound, and the guard's noteNotYours, noteLocked and noteFailed. Returns whether
-- the text changed.
create function public.edit_card_note(c uuid, note bigint, note_body text) returns boolean
language plpgsql security definer set search_path='' as $$
declare changed bigint;
begin
 if not public.work_can_edit(c) then raise exception 'noteNotAllowed' using errcode='42501'; end if;
 if not exists(select 1 from public.work_comments where id=note and company_id=c) then raise exception 'noteNotFound' using errcode='P0002'; end if;
 update public.work_comments set body=btrim(coalesce(note_body,''), E' \t\r\n') where id=note and company_id=c returning id into changed;
 return changed is not null;
end $$;
revoke all on function public.edit_card_note(uuid,bigint,text) from public,anon,service_role;
grant execute on function public.edit_card_note(uuid,bigint,text) to authenticated;

-- Where a message calls a name: the first place "@" and the name stand, in any case, after the start, a space or a
-- punctuation mark and before the end, a space or a punctuation mark (Arabic ، ؛ ؟ count); 0 when it does not. The
-- general channel calls Agents by it and a note calls Members and Agents by it.
create function public.mention_at(message text, called text) returns integer language plpgsql immutable set search_path='' as $$
declare t text := lower(coalesce(message,'')); handle text := '@'||lower(btrim(coalesce(called,''))); found_at int; from_at int := 1;
begin
 if handle = '@' then return 0; end if;
 loop
  found_at := strpos(substr(t, from_at), handle); exit when found_at = 0; found_at := found_at + from_at - 1;
  if (found_at = 1 or substr(t, found_at-1, 1) ~ '[[:space:][:punct:]،؛؟]')
     and (found_at + length(handle) > length(t) or substr(t, found_at+length(handle), 1) ~ '[[:space:][:punct:]،؛؟]') then
   return found_at;
  end if;
  from_at := found_at + 1;
 end loop;
 return 0;
end $$;
revoke all on function public.mention_at(text,text) from public,anon,authenticated,service_role;

-- 20261219000000's channel_mention, its boundary test now mention_at's; it calls the same Agent for every message.
create or replace function public.channel_mention(c uuid, person uuid, message text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare a record; best uuid; best_at int; best_len int; found_at int;
begin
 for a in select h.id, btrim(h.name) agent_name from public.hermes_agents h
   where h.company_id=c and btrim(h.name)<>'' and public.agent_visible_to(c, person, h.id) order by h.is_default desc, h.id loop
  found_at := public.mention_at(message, a.agent_name);
  if found_at > 0 and (best is null or found_at < best_at or (found_at = best_at and length(lower(a.agent_name)) > best_len)) then
   best := a.id; best_at := found_at; best_len := length(lower(a.agent_name));
  end if;
 end loop;
 return best;
end $$;

-- A mention waits for its Member as one item per note, which opens the note on its Card.
alter table public.waiting_items add column note_id bigint,
 add foreign key (company_id, card_id, note_id) references public.work_comments(company_id, card_id, id);
create unique index waiting_items_one_per_note on public.waiting_items(note_id, person_id) where note_id is not null;

-- The one Run of a note that calls an Agent, keyed by that note. Everything a start sends is pinned before the first
-- attempt, as for a channel message (20261219000000): the session (one per Card and Agent, so the Agent keeps the
-- Card's context from note to note), the input, the Agent's instructions and its lasting rules in force (#18); the
-- Connection at the first attempt. Every attempt is the same engine request under the idempotency key 'note:' || note_id
-- (lib/channel-runs.mjs), which the engine contract makes one Run. A completed Run keeps its reply, which is copied
-- into the log once. agent_id has no foreign key: an Agent removed later leaves its replies.
create table public.note_runs (
 note_id bigint primary key,
 company_id uuid not null,
 card_id bigint not null,
 agent_id uuid not null,
 agent_name text not null,
 session uuid not null,
 input text not null,
 instructions text,
 rules text[] not null default '{}',
 connection_id uuid references public.hermes_connections(id) on delete set null,
 attempts integer not null default 0 check (attempts >= 0),
 attempted_at timestamptz,
 run_id text unique check (run_id is null or attempts > 0),
 outcome text check (outcome in ('completed','failed','stopped','lost')),
 reply text check (reply is null or outcome='completed'),
 input_tokens bigint check (input_tokens >= 0),
 output_tokens bigint check (output_tokens >= 0),
 created_at timestamptz not null default now(),
 closed_at timestamptz,
 foreign key (company_id, card_id, note_id) references public.work_comments(company_id, card_id, id),
 check ((outcome is null) = (closed_at is null)),
 check ((input_tokens is null) = (output_tokens is null))
);
create index note_runs_open on public.note_runs(note_id) where outcome is null;
create index note_runs_connection on public.note_runs(connection_id) where outcome is null;
create index note_runs_by_card on public.note_runs(company_id, card_id);

-- The log takes the replies of note Runs, copied from note_runs.
alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit','note_runs'));

-- What a note written by a person (not an Agent through the API) calls, read once when it is written. Members: "@" and
-- an active Member's full or first name, never the writer; one item each. An Agent: as in the general channel
-- (channel_mention), so only an Agent the writer sees, and the note's one Run with the Agent's input ('<first name>:
-- <note>'), instructions and rules pinned.
create function public.note_mentions() returns trigger language plpgsql security definer set search_path='' as $$
declare writer text; card_title text; chosen public.hermes_agents;
begin
 if public.log_actor_kind(new.company_id, new.author_id) <> 'person' then return null; end if;
 select coalesce(btrim(name),'') into writer from public.people where id=new.author_id;
 select btrim(title) into card_title from public.work_cards where company_id=new.company_id and id=new.card_id;
 insert into public.waiting_items(company_id, person_id, kind, title, body, asked_by, card_id, note_id)
  select new.company_id, m.person_id, 'mention', left(coalesce(nullif(card_title,''), '#'||new.card_id), 300), left(new.body, 4000),
   left(coalesce(writer,''), 120), new.card_id, new.id
  from public.members m join public.people p on p.id=m.person_id
  where m.company_id=new.company_id and m.removed_at is null and m.agent_role is null and m.person_id <> new.author_id
   and not exists(select 1 from public.agents a where a.id=m.person_id) and btrim(p.name) <> ''
   and (public.mention_at(new.body, p.name) > 0 or public.mention_at(new.body, split_part(btrim(p.name),' ',1)) > 0)
  on conflict (note_id, person_id) where note_id is not null do nothing;
 select * into chosen from public.hermes_agents where id=public.channel_mention(new.company_id, new.author_id, new.body);
 if chosen.id is not null then
  insert into public.note_runs(note_id, company_id, card_id, agent_id, agent_name, session, input, instructions, rules)
   values (new.id, new.company_id, new.card_id, chosen.id, chosen.name, md5('note:'||new.card_id||':'||chosen.id::text)::uuid,
           split_part(coalesce(writer,''),' ',1)||': '||new.body, nullif(btrim(chosen.instructions),''), public.agent_rules_in_force(chosen.id))
   on conflict (note_id) do nothing;
 end if;
 return null;
end $$;
revoke all on function public.note_mentions() from public,anon,authenticated,service_role;
create trigger work_comments_mentions after insert on public.work_comments for each row when (strpos(new.body,'@') > 0)
 execute function public.note_mentions();

-- The Run lifecycle, as 20261219000000's for channel messages and reached only from lib/channel-runs.mjs: service_role
-- only, each step one guarded change of the row under its lock. A fresh Run belongs to its writer's request for one
-- minute (just_message drives it at once), a start whose answer is not in yet to that attempt for thirty seconds; then
-- anyone drives it. Pages of 500 after the note `after`.
create function public.note_runs_due(just_message bigint default null, after bigint default 0)
returns table(message bigint, run text, connection uuid, address text, profile text, state text, key_encrypted text)
language sql stable security definer set search_path='' as $$
 select r.note_id, r.run_id, r.connection_id, h.address, h.profile, h.state, case when r.run_id is not null then h.key_encrypted end
 from public.note_runs r left join public.hermes_connections h on h.id=r.connection_id
 where r.outcome is null and r.note_id > coalesce(after, 0) and (just_message is null or r.note_id=just_message)
  and (r.run_id is not null or r.note_id=just_message
   or (r.attempts = 0 and r.created_at < now()-interval '1 minute') or (r.attempts > 0 and r.attempted_at < now()-interval '30 seconds'))
 order by r.note_id limit 500;
$$;

-- One attempt to start, or no row when there is nothing to do now; the profile move's lock is taken first, as for a
-- channel message.
create function public.begin_note_start(message bigint)
returns table(attempt integer, company uuid, connection uuid, session uuid, input text, instructions text, rules text[])
language plpgsql security definer set search_path='' as $$
declare r public.note_runs; linked public.hermes_connections;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.note_runs where note_id=message for update;
 if r.note_id is null or r.outcome is not null or r.run_id is not null then return; end if;
 if r.attempts = 0 and r.created_at < now()-interval '10 minutes' then perform public.close_note_run(message,null,'failed',null,null,null); return; end if;
 if r.attempts > 0 and r.created_at < now()-interval '1 day' then perform public.close_note_run(message,null,'lost',null,null,null); return; end if;
 if r.attempts = 0 then
  select a.connection_id into r.connection_id from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id;
  if r.connection_id is null then perform public.close_note_run(message,null,'failed',null,null,null); return; end if;
 elsif r.connection_id is null then
  perform public.close_note_run(message,null,'lost',null,null,null); return;
 end if;
 select * into linked from public.hermes_connections where id=r.connection_id;
 if linked.profile ~ '^co-[0-9a-f]{32}$' and (linked.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 update public.note_runs set attempts=attempts+1, attempted_at=now(), connection_id=r.connection_id
  where note_id=message returning attempts into r.attempts;
 return query select r.attempts, r.company_id, r.connection_id, r.session, r.input, r.instructions, r.rules;
end $$;

create function public.answer_note_start(message bigint, attempt integer, run text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.note_runs;
begin
 select * into r from public.note_runs where note_id=message for update;
 if r.note_id is null or r.outcome is not null then return false; end if;
 if run is not null then
  if r.run_id is not null then return r.run_id = run; end if;
  update public.note_runs set run_id=run where note_id=message; return true;
 end if;
 if attempt = 1 and r.attempts = 1 and r.run_id is null then
  return public.close_note_run(message, null, 'failed', null, null, null);
 end if;
 return false;
end $$;

-- A completed Run's reply is a row of the Company log under its note, written by its Agent.
create function public.close_note_run(message bigint, run text, run_outcome text, reply text, used_input bigint, used_output bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.note_runs;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(reply),'') <> '')
  or (used_input is null) <> (used_output is null) then
  raise exception 'noteFailed' using errcode='22023'; end if;
 update public.note_runs set outcome=run_outcome, closed_at=now(), input_tokens=used_input, output_tokens=used_output,
  reply=case when run_outcome='completed' then left(close_note_run.reply, 200000) end
  where note_id=message and outcome is null and run_id is not distinct from run returning * into r;
 if r.note_id is null then return false; end if;
 if run_outcome='completed' then
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,body,source,source_id,created_at)
   values (r.company_id, r.agent_id, 'agent', r.agent_name, 'card', r.card_id, r.agent_id, 'note_reply',
           jsonb_build_object('reply_to', r.note_id), r.reply, 'note_runs', r.note_id, r.closed_at)
   on conflict (source,source_id) do nothing;
 end if;
 return true;
end $$;

revoke all on function public.note_runs_due(bigint,bigint) from public,anon,authenticated;
revoke all on function public.begin_note_start(bigint) from public,anon,authenticated;
revoke all on function public.answer_note_start(bigint,integer,text) from public,anon,authenticated;
revoke all on function public.close_note_run(bigint,text,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.note_runs_due(bigint,bigint), public.begin_note_start(bigint),
 public.answer_note_start(bigint,integer,text), public.close_note_run(bigint,text,text,text,bigint,bigint) to service_role;

alter table public.note_runs enable row level security;
-- A Member reads a note's Run while they see its Agent: its state only, never what was sent, its Connection, its engine
-- run id or its reply (read in the log).
create policy note_runs_read on public.note_runs for select to authenticated using (public.can_see_agent(company_id, agent_id));
revoke all on public.note_runs from anon, authenticated, service_role;
grant select (note_id, company_id, card_id, agent_id, agent_name, outcome, created_at, closed_at) on public.note_runs to authenticated;

-- A profile move also waits for every open note Run on a Connection it would replace, as for a channel Run. The rest is
-- 20261219000000's move unchanged.
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
  or exists(select 1 from public.note_runs r where r.connection_id=any(olds) and r.outcome is null)
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

-- An Owner's usage per day also counts the note Runs that ran, as it counts channel Runs. The rest is 20261219000000's
-- usage_by_day unchanged.
create or replace function public.usage_by_day() returns table(company_id uuid, company_name text, day date, input_tokens bigint, output_tokens bigint, runs bigint, unknown_runs bigint)
language sql stable security definer set search_path='' as $$
 select u.company_id, co.name, (u.at at time zone 'UTC')::date, coalesce(sum(u.input_tokens),0)::bigint, coalesce(sum(u.output_tokens),0)::bigint, count(*), count(*) filter (where u.input_tokens is null)
 from (
  select company_id, recorded_at at, input_tokens, output_tokens from public.conversation_usage
  union all
  select company_id, closed_at, input_tokens, output_tokens from public.channel_runs where outcome is not null and run_id is not null
  union all
  select company_id, closed_at, input_tokens, output_tokens from public.note_runs where outcome is not null and run_id is not null
 ) u join public.companies co on co.id=u.company_id
 where auth.uid() is not null and public.is_company_owner(u.company_id)
 group by u.company_id, co.name, (u.at at time zone 'UTC')::date
 order by 3 desc, 2;
$$;
