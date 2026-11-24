-- #674 (spec #667, ADR 0026): a person archives their own Conversations and restores them. Archived is a time and a
-- person on the Conversation; nothing in it is deleted and no append-only rule changes. Archiving stops what its Agent
-- is doing there (its open Run, the turns waiting behind it, a Handover it started) through the Stop that exists, and
-- closes what the Agent asks its person there, so nothing waits on them because of it (stop_conversation_work,
-- 20270415999992). Its Card is left alone, as archiving a Card leaves its Conversation. Every list of current
-- Conversations leaves it out in the database, and a message written in it, sent or queued, brings it back. The Engine
-- keeps the same mark on the Conversation's session (the pinned Hermes's own session flag): the worker sends it, so an
-- Engine that is down only delays the mark. The Agent's memory is the Engine's and is not touched.

alter table public.conversations add column archived_at timestamptz;
alter table public.conversations add column archived_by uuid references public.people(id) on delete set null;
alter table public.conversations add constraint conversations_archived_by_archived check (archived_by is null or archived_at is not null);
-- What the Engine last took for the Conversation's session: true archived, false not, null never told (not archived).
alter table public.conversations add column session_archived boolean;
-- A session the Engine said it does not keep (yet): since when, and when to ask it again. A Run's session is written
-- by the Engine as the Run goes, so a session named by a Run stopped early may not be there at first; it is asked again
-- for a day before the mark is let go.
alter table public.conversations add column session_missing_since timestamptz;
alter table public.conversations add column session_mark_after timestamptz;
-- The sessions whose mark the Engine still has to take, for the worker's pass.
create index conversations_session_mark on public.conversations(id)
 where hermes_session_id is not null and (archived_at is not null) is distinct from coalesce(session_archived,false);

-- Each archive and restore of a Conversation, kept as the source of its Activity log row. The row goes where the
-- Conversation's other events go (log_chat_event): on its Card when it is a Card's chat, else its person's own.
create table public.conversation_archives (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 actor_id uuid references public.people(id) on delete set null,
 action text not null check (action in ('archived','restored')),
 created_at timestamptz not null default now()
);
alter table public.conversation_archives enable row level security;
revoke all on public.conversation_archives from anon,authenticated,service_role;
alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in
 ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit','note_runs','reply_cards',
  'member_invitations','reply_card_answers','channel_permissions','agent_handovers','channel_handover_replies','channel_cards','channel_replies',
  'conversation_archives'));

-- One archive or restore of Conversation `v` by its person (`actor`), kept and logged with its title.
create function public.log_conversation_archive(v uuid, archived boolean, actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; logged bigint; writer text;
begin
 select * into talk from public.conversations x where x.id=v;
 insert into public.conversation_archives(company_id,conversation_id,actor_id,action)
  values(talk.company_id,v,actor,case when archived then 'archived' else 'restored' end) returning id into logged;
 select p.name into writer from public.people p where p.id=actor;
 perform public.log_chat_event(v,actor,'person',coalesce(writer,''),case when archived then 'conversation_archived' else 'conversation_restored' end,
  jsonb_build_object('title',public.conversation_title(v,talk.agent_name)),actor,'conversation_archives',logged,now());
end $$;
revoke all on function public.log_conversation_archive(uuid,boolean,uuid) from public,anon,authenticated,service_role;

-- A Run's Engine session is kept with its Conversation when the Run was stopped too, not only when it replied, so an
-- archived Conversation whose only Run was stopped still has a session to mark in its Engine (a failed Run's is still
-- not kept). 20270411000000's as 20270415999950 left it (taking no_access), but for that.
create or replace function public.close_conversation_run(conversation uuid, run text, run_outcome text, reply text, hermes_session text, used_input bigint, used_output bigint, read_completed boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.conversations; closed text; carded boolean := false;
begin
 if run_outcome is null or run_outcome not in ('completed','stopped','lost','failed','no_model','no_credit','key_refused','model_missing','no_access') or run_outcome='completed' and coalesce(btrim(reply),'')='' then raise exception 'conversationFailed' using errcode='22023'; end if;
 select * into existing from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages where conversation_id=conversation and author='person' and run_id=run) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if run_outcome='failed' and read_completed then
  carded := exists(select 1 from public.reply_cards where conversation_id=conversation and run_id=run and kind in ('draft','review','hand'))
   or exists(select 1 from public.lead_made_agents where conversation_id=conversation and run_id=run)
   or exists(select 1 from public.lead_agent_requests where conversation_id=conversation and run_id=run)
   or exists(select 1 from public.agent_rules where conversation_id=conversation and run_id=run);
 end if;
 insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
  values(existing.company_id,conversation,run,case when carded then 'completed' else run_outcome end)
  on conflict do nothing returning run_id into closed;
 if closed is null then return false; end if;
 if run_outcome='completed' then
  insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
   values(existing.company_id,conversation,'agent',existing.agent_id,existing.agent_name,left(reply,200000),run) on conflict do nothing;
 end if;
 if run_outcome in ('completed','stopped') or carded then
  update public.conversations set hermes_session_id=hermes_session where id=conversation and hermes_session_id is null and hermes_session is not null;
 end if;
 return true;
end;
$$;

-- What archiving the reader's own named Conversations would stop, one line per thing, for the one confirmation that
-- names each (conversation_work_stops, 20270415999992). A Conversation with nothing going on answers nothing, so nothing
-- is asked; one archived already, someone else's or another Company's answers nothing.
create function public.conversation_archive_stops(c uuid, chats uuid[]) returns table(conversation uuid, kind text, agent text, agent_id uuid)
language sql stable security definer set search_path='' as $$
 select v.id, s.kind, s.agent_name, s.agent_id
 from public.own_conversations(c) v cross join lateral public.conversation_work_stops(v.id) s
 where v.id=any(chats) and v.archived_at is null
 order by v.id, array_position(array['run','question','permission','hand'],s.kind);
$$;
revoke all on function public.conversation_archive_stops(uuid,uuid[]) from public,anon,service_role;
grant execute on function public.conversation_archive_stops(uuid,uuid[]) to authenticated;

-- Archives the reader's own named Conversations in Company `c`, each once, and answers the ones it archived: a
-- Conversation that is someone else's, another Company's, hidden from them or archived already is skipped. Each is
-- stopped and its asks closed first (stop_conversation_work); its Card is not touched; one Activity log row says so
-- (log_conversation_archive). Any Member, a Viewer too, tidies their own. Refused (42501 conversationArchiveNotAllowed) for anyone outside the Company.
create function public.archive_conversations(c uuid, chats uuid[]) returns setof uuid
language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 if auth.uid() is null or not public.is_member(c) then raise exception 'conversationArchiveNotAllowed' using errcode='42501'; end if;
 for v in select o.id from public.own_conversations(c) o where o.id=any(chats) and o.archived_at is null order by o.id loop
  perform 1 from public.conversations x where x.id=v and x.archived_at is null for update;
  if not found then continue; end if;
  perform public.stop_conversation_work(v);
  update public.conversations x set archived_at=now(), archived_by=auth.uid() where x.id=v;
  perform public.log_conversation_archive(v,true,auth.uid());
  return next v;
 end loop;
end $$;
revoke all on function public.archive_conversations(uuid,uuid[]) from public,anon,service_role;
grant execute on function public.archive_conversations(uuid,uuid[]) to authenticated;

-- Restores the reader's own named archived Conversations, each once, and answers the ones it restored. Restoring starts
-- nothing: no Run, turn, question or step comes back; one Activity log row says so. Refused (42501 conversationRestoreNotAllowed) outside the Company.
create function public.restore_conversations(c uuid, chats uuid[]) returns setof uuid
language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 if auth.uid() is null or not public.is_member(c) then raise exception 'conversationRestoreNotAllowed' using errcode='42501'; end if;
 for v in select o.id from public.own_conversations(c) o where o.id=any(chats) and o.archived_at is not null order by o.id loop
  update public.conversations x set archived_at=null, archived_by=null where x.id=v and x.archived_at is not null;
  if found then perform public.log_conversation_archive(v,false,auth.uid()); return next v; end if;
 end loop;
end $$;
revoke all on function public.restore_conversations(uuid,uuid[]) from public,anon,service_role;
grant execute on function public.restore_conversations(uuid,uuid[]) to authenticated;

-- A message its person writes in an archived Conversation brings it back, with its log row: sent, queued while the
-- Agent answers, or addressed to a Member. An Agent's reply (a Run closing after the archive) leaves it archived. So does the late record
-- of a message sent or queued before the archive, whose start was on its way when it was archived (its reservation or
-- its queued turn is older than the archive): that is no new writing, and its Run is stopped as it lands, as archiving
-- stops the Runs already named.
create function public.restore_written_conversation() returns trigger
language plpgsql security definer set search_path='' as $$
declare v public.conversations;
begin
 select * into v from public.conversations x where x.id=new.conversation_id;
 if v.archived_at is null then return null; end if;
 if tg_table_name='conversation_messages' then
  if new.author<>'person' then return null; end if;
  if exists(select 1 from public.conversation_queued_turns q where q.conversation_id=v.id and q.send_key=new.send_key and q.queued_at<=v.archived_at)
   or exists(select 1 from public.conversation_run_reservations r where r.conversation_id=v.id and r.send_key=new.send_key and r.created_at<=v.archived_at) then
   if new.run_id is not null then
    insert into public.stopped_runs(company_id,conversation_id,run_id) values(v.company_id,v.id,new.run_id) on conflict do nothing;
   end if;
   return null;
  end if;
 end if;
 update public.conversations set archived_at=null, archived_by=null where id=v.id and archived_at is not null;
 if found then perform public.log_conversation_archive(v.id,false,new.person_id); end if;
 return null;
end $$;
revoke all on function public.restore_written_conversation() from public,anon,authenticated,service_role;
create trigger conversation_messages_restore after insert on public.conversation_messages for each row execute function public.restore_written_conversation();
create trigger conversation_queued_turns_restore after insert on public.conversation_queued_turns for each row execute function public.restore_written_conversation();
create trigger conversation_notes_restore after insert on public.conversation_notes for each row execute function public.restore_written_conversation();

-- The worker's: each Conversation whose Engine session has yet to take its archived mark (or lose it), with the
-- profile of its Agent the session lives on (none once the Agent is gone), a page of 100 at a time. A session the Engine
-- did not keep a moment ago waits its turn (session_mark_after), so it holds no place in the page meanwhile.
create function public.conversation_sessions_to_mark() returns table(conversation uuid, company uuid, profile text, session text, archived boolean)
language sql stable security definer set search_path='' as $$
 select v.id, v.company_id, a.profile, v.hermes_session_id, v.archived_at is not null
 from public.conversations v left join public.hermes_agents a on a.id=v.agent_id and a.company_id=v.company_id
 where v.hermes_session_id is not null and (v.archived_at is not null) is distinct from coalesce(v.session_archived,false)
  and (v.session_mark_after is null or v.session_mark_after<=now())
 order by v.id limit 100;
$$;
revoke all on function public.conversation_sessions_to_mark() from public,anon,authenticated;
grant execute on function public.conversation_sessions_to_mark() to service_role;

-- The worker's: the Engine took the mark `archived` for the Conversation's session. Kept only while the Conversation
-- still is so; a restore or an archive since asks for the other mark on the next pass. True when kept.
create function public.conversation_session_marked(conversation uuid, archived boolean) returns boolean
language sql security definer set search_path='' as $$
 with kept as (update public.conversations v set session_archived=archived, session_missing_since=null, session_mark_after=null
  where v.id=conversation and (v.archived_at is not null)=archived and v.hermes_session_id is not null returning 1)
 select exists(select 1 from kept);
$$;
revoke all on function public.conversation_session_marked(uuid,boolean) from public,anon,authenticated;
grant execute on function public.conversation_session_marked(uuid,boolean) to service_role;

-- The worker's: the Engine keeps no session by that name for the Conversation, or its Agent is gone. A session not
-- written yet is asked again a minute later; one missing for a day, or a Conversation with no Agent left, has nothing to
-- mark and is settled as it is. True when settled.
create function public.conversation_session_missing(conversation uuid, archived boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare v public.conversations; gone boolean;
begin
 select * into v from public.conversations x where x.id=conversation and (x.archived_at is not null)=archived and x.hermes_session_id is not null for update;
 if v.id is null then return false; end if;
 gone:=v.agent_id is null or not exists(select 1 from public.hermes_agents a where a.id=v.agent_id and a.company_id=v.company_id and a.profile is not null)
  or coalesce(v.session_missing_since<now()-interval '1 day',false);
 if gone then
  update public.conversations x set session_archived=archived, session_missing_since=null, session_mark_after=null where x.id=v.id;
 else
  update public.conversations x set session_missing_since=coalesce(x.session_missing_since,now()), session_mark_after=now()+interval '1 minute' where x.id=v.id;
 end if;
 return gone;
end $$;
revoke all on function public.conversation_session_missing(uuid,boolean) from public,anon,authenticated;
grant execute on function public.conversation_session_missing(uuid,boolean) to service_role;

-- #673's All conversations list and counts ask archived_at for the Conversation's part too: made once, with the
-- channel's part beside it, in 20270415999995_archive_channels.sql (#675).
