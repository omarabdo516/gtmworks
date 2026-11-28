-- #881 (spec #864, ADR 0033): the sidebar and All conversations list a person's Conversations from their rows joined
-- with their Agents' sessions in the Engine, and a Conversation's title and archived mark are its session's own. The
-- database keeps only what is about people: the rows, who archived or restored a Conversation, and the old record's work
-- an archive stops. No table is changed or dropped; the old list, counts, archive and restore functions stay as they are
-- for the previous app version and go in the removals spec.

-- The channels the reader is in, current or archived, each with its newest message: All conversations lists them beside
-- the person's Conversations, which are read from the Engine. Channels keep their own record (ADR 0033 item 3).
-- shortcut: every channel of the list at once, 500 at most; upgrade if a person is in more channels than that.
create function public.channel_list(c uuid, archived boolean default false)
 returns table(id uuid, kind text, name text, last_at timestamp with time zone, last_body text)
 language sql stable security definer set search_path to ''
as $$
 select k.id, k.kind, k.name,
  coalesce((select m.created_at from public.channel_messages m where m.channel_id=k.id order by m.id desc limit 1),k.created_at),
  (select m.body from public.channel_messages m where m.channel_id=k.id and m.body<>'' and m.hand_card is null order by m.id desc limit 1)
 from public.channels k
 where k.company_id=c and auth.uid() is not null and public.in_channel(k.id) and (k.archived_at is not null)=channel_list.archived
 order by 4 desc, k.id desc
 limit 500;
$$;
revoke all on function public.channel_list(uuid,boolean) from public,anon;
grant execute on function public.channel_list(uuid,boolean) to authenticated;

-- A Conversation archived or restored on its session (the Engine's own mark, written by the app first): the person's
-- own act is logged, and an archive stops what the old record still runs for it (stop_conversation_work). The old
-- record's own mark is cleared, and with it the old worker's mark (session_archived), so the worker
-- (lib/conversation-archive.mjs) never writes the session's mark back. Answers the Conversations it logged: the
-- signed-in person's own, in this Company.
create function public.log_conversations_archived(c uuid, chats uuid[], archived boolean) returns setof uuid
 language plpgsql security definer set search_path to ''
as $$
declare v uuid;
begin
 if auth.uid() is null or not public.is_member(c) then raise exception 'conversationArchiveNotAllowed' using errcode='42501'; end if;
 for v in select o.id from public.own_conversations(c) o where o.id=any(chats) order by o.id loop
  perform 1 from public.conversations x where x.id=v for update;
  if archived then perform public.stop_conversation_work(v); end if;
  update public.conversations x set archived_at=null, archived_by=null, session_archived=null where x.id=v;
  perform public.log_conversation_archive(v,archived,auth.uid());
  return next v;
 end loop;
end $$;
revoke all on function public.log_conversations_archived(uuid,uuid[],boolean) from public,anon;
grant execute on function public.log_conversations_archived(uuid,uuid[],boolean) to authenticated;

-- The slow drift check (lib/conversation-drift.mjs, ADR 0031 item 4): each Company's Conversation sessions by the profile
-- of their Agent, an hour old or more (an Agent whose profile is still being made is left out), so a session a new Conversation chose before its first Run is never taken for
-- gone. A Conversation whose Agent is gone has no profile: its row is forgotten without asking the Engine (decision
-- 0074: deleting an Agent deletes its Conversations).
create function public.conversation_drift() returns table(company_id uuid, profile text, sessions text[])
 language sql stable security definer set search_path to ''
as $$
 select v.company_id, a.profile, array_agg(v.hermes_session_id order by v.hermes_session_id)
 from public.conversations v left join public.hermes_agents a on a.id=v.agent_id and a.company_id=v.company_id
 where v.hermes_session_id is not null and v.created_at<now()-interval '1 hour' and (a.id is null or a.profile is not null)
 group by v.company_id, a.profile
 order by v.company_id, a.profile nulls first;
$$;
-- Forgets one Company's rows whose sessions the Engine no longer holds; answers how many. A row the old record still
-- holds messages or turns for is kept: that record is Omar's to remove (spec #864, the removals spec).
create function public.forget_conversations(c uuid, sessions text[]) returns integer
 language plpgsql security definer set search_path to ''
as $$
declare v uuid; n integer:=0;
begin
 for v in select x.id from public.conversations x where x.company_id=c and x.hermes_session_id=any(sessions) and x.created_at<now()-interval '1 hour' order by x.id loop
  begin
   delete from public.conversations x where x.id=v;
   n:=n+1;
  exception when foreign_key_violation then null;
  end;
 end loop;
 return n;
end $$;
revoke all on function public.conversation_drift() from public,anon,authenticated;
revoke all on function public.forget_conversations(uuid,text[]) from public,anon,authenticated;
grant execute on function public.conversation_drift() to service_role;
grant execute on function public.forget_conversations(uuid,text[]) to service_role;
