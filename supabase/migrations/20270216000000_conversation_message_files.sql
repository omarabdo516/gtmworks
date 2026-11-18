-- #155: an image a person attaches to a message in their Conversation is sent with it, and the Agent's Run reads it.
-- The Conversation's files table and its private folder in the `creatives` bucket already exist (#21); this links each
-- row to the message it was sent with and lets its sender write it before the Agent is asked.
--
-- Additive: the previous app version reads every row it read before, and a message it writes is still a message with
-- text. What changes for it is only that a stored message's body may now be empty: a message may carry images alone.

-- The message a send key becomes, and the files' place in it (chosen order). A file's row is written before the message
-- exists, so `message_id` is filled by the trigger below; a send that waits behind a Run gets its message later.
alter table public.conversation_attachments
 add column send_key uuid,
 add column message_id bigint references public.conversation_messages(id),
 add column position smallint not null default 0 check (position between 0 and 20);
create index conversation_attachments_message on public.conversation_attachments(message_id);
create index conversation_attachments_send on public.conversation_attachments(conversation_id, send_key);

-- The message a send key becomes takes the files sent with it, whenever it is stored: a send that went straight to the
-- Agent, or a turn that waited behind one and started later (record_conversation_turn). A message is append-only, so
-- this runs once per message and leaves every file it does not name.
create function public.link_conversation_files() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.author='person' and new.send_key is not null then
  update public.conversation_attachments set message_id=new.id
   where conversation_attachments.conversation_id=new.conversation_id and conversation_attachments.company_id=new.company_id
    and conversation_attachments.send_key=new.send_key and conversation_attachments.message_id is null;
 end if;
 return null;
end;
$$;
revoke all on function public.link_conversation_files() from public,anon,authenticated,service_role;
create trigger conversation_messages_link_files after insert on public.conversation_messages for each row execute function public.link_conversation_files();

-- The sender's files, kept before the Agent is asked and under the send key, so a retry of the same send finds the same
-- ones. The caller is the person sending, so the database checks the Conversation is theirs, or is the one they are
-- starting, and that they may write in the Company (conversation_can_write). Another person's Conversation refuses, as
-- it does everywhere else. The bytes are put in the Company's `conversations/<conversation>/` folder for these paths by
-- the server; the table's own check keeps every path inside it.
create function public.reserve_conversation_files(conversation uuid, c uuid, message_key uuid, files jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare existing public.conversations;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if conversation is null or message_key is null or files is null or jsonb_typeof(files)<>'array'
  or jsonb_array_length(files) not between 1 and 5 then
  raise exception 'conversationFilesInvalid' using errcode='22023'; end if;
 select * into existing from public.conversations where id=conversation;
 if found and (existing.person_id<>auth.uid() or existing.company_id<>c) then
  raise exception 'conversationNotFound' using errcode='P0002'; end if;
 insert into public.conversation_attachments(company_id,conversation_id,send_key,position,message_id,name,content_type,size,path)
  select c,conversation,message_key,
   coalesce((file->>'position')::smallint,(ord-1)::smallint),
   (select m.id from public.conversation_messages m where m.conversation_id=conversation and m.send_key=message_key and m.author='person' order by m.id limit 1),
   file->>'name',file->>'content_type',(file->>'size')::bigint,file->>'path'
  from jsonb_array_elements(files) with ordinality as chosen(file,ord)
  on conflict (company_id,path) do nothing;
 return (select count(*)::integer from public.conversation_attachments a where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key);
end;
$$;
revoke all on function public.reserve_conversation_files(uuid,uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.reserve_conversation_files(uuid,uuid,uuid,jsonb) to authenticated;

-- A send the Agent's engine refused stored no message, so its sender's files go: the rows, with the paths the server
-- then removes from the bucket. Only the sender's own Conversation, and only files no message took.
create function public.discard_conversation_files(conversation uuid, c uuid, message_key uuid)
returns setof text language plpgsql security definer set search_path='' as $$
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if not exists(select 1 from public.conversations v where v.id=conversation and v.company_id=c and v.person_id=auth.uid()) then
  raise exception 'conversationNotFound' using errcode='P0002'; end if;
 return query delete from public.conversation_attachments a
  where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key and a.message_id is null
  returning a.path;
end;
$$;
revoke all on function public.discard_conversation_files(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.discard_conversation_files(uuid,uuid,uuid) to authenticated;

-- A message may carry images alone (#155), so a stored message's body may be empty. The record is still append-only and
-- every message the previous app version writes keeps its text.
alter table public.conversation_messages drop constraint conversation_messages_body_check;
alter table public.conversation_messages add constraint conversation_messages_body_check check (length(body) between 0 and 200000);
alter table public.conversation_queued_turns drop constraint conversation_queued_turns_message_check;
alter table public.conversation_queued_turns add constraint conversation_queued_turns_message_check check (length(message) between 0 and 200000);

-- The sender's one entry point, as 20270112000000_question_cards.sql has it, with one change: a message may be images
-- alone, so its text may be empty.
create or replace function public.reserve_conversation_turn(conversation uuid, c uuid, agent uuid, message_key uuid, message text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.conversations; chosen public.hermes_agents; queued public.conversation_queued_turns; noted public.conversation_notes; addressee record; writer text; pinned uuid;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if message is null or length(message) not between 0 and 200000 or message_key is null then raise exception 'conversationNotFound' using errcode='22023'; end if;
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
 -- A send key already claimed as a question's answer (#138: a send whose first try found no question, retried once one
 -- had opened) is that answer: it neither queues nor starts a Run, so the message reaches the Agent once.
 if exists(select 1 from public.reply_cards r where r.conversation_id=conversation and r.kind='question' and r.answer_key=message_key) then
  return jsonb_build_object('state','answered');
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
 -- The profile the reservation pinned travels beside its token, as 20270213000000_one_hermes.sql left this answer.
 return jsonb_build_object('state','reserved','connection',pinned,'profile',(select r.profile from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key),'note',public.pinned_run_note(conversation,message_key,c,auth.uid()));
end $$;

-- A claimed turn says whether it carries images, so the worker reads them from the Conversation's files only when it
-- must: every turn without one starts exactly as before.
drop function public.claim_conversation_turn(uuid);
create function public.claim_conversation_turn(conversation uuid)
 returns table(company uuid, agent uuid, person uuid, send_key uuid, message text, connection uuid, profile text, note text, retry boolean, has_files boolean)
 language plpgsql security definer set search_path='' as $function$
declare turn public.conversation_queued_turns; held public.conversation_run_reservations; uncertain boolean; refusal text; target text; token uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 -- The agents lock comes before anything is read: a turn's start is recorded under it (record_conversation_turn), and a
 -- claim that met a record half done read the recorded turn as still waiting and reserved it again; nothing cleared
 -- that reservation, and it held up every later turn of the Conversation (#70). The order stays turns first.
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if exists(select 1 from public.conversation_open_run(conversation)) then return; end if;
 select q.* into turn from public.conversation_queued_turns q where q.conversation_id=conversation and q.started_at is null and q.failed_at is null
  order by exists(select 1 from public.conversation_run_reservations r where r.conversation_id=q.conversation_id and r.send_key=q.send_key and r.abandoned_at is null) desc,q.queued_at,q.send_key limit 1;
 if not found then return; end if;
 -- Its message was recorded meanwhile (the direct send's late record of a start once marked unknown): it already ran.
 if exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.send_key=turn.send_key and m.author='person') then
  perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
  update public.conversation_queued_turns q set started_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key;
  delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=turn.send_key and r.abandoned_at is null;
  return;
 end if;
 if exists(select 1 from public.conversation_run_reservations r where r.conversation_id=conversation and r.abandoned_at is null and r.send_key<>turn.send_key) then return; end if;
 if not exists(select 1 from public.members m where m.company_id=turn.company_id and m.person_id=turn.person_id and m.removed_at is null and m.role<>'viewer')
  or not exists(select 1 from public.conversations cv where cv.id=conversation and cv.agent_id=turn.agent_id) then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=turn.send_key and r.abandoned_at is null;
 uncertain:=held.conversation_id is not null and (held.start_unknown_at is not null or held.start_attempts>0);
 if held.conversation_id is not null then target:=held.profile; token:=held.connection_id;
 else select a.profile,a.connection_id into target,token from public.hermes_agents a where a.id=turn.agent_id and a.company_id=turn.company_id;
 end if;
 refusal:=public.agent_profile_refusal(target,turn.company_id,turn.agent_id);
 -- A start that may have happened is never failed here: it waits for its own profile to be usable again.
 if (target is null or (target ~ '^co-[0-9a-f]{32}$' and target<>public.company_engine_profile(turn.company_id)) or refusal='hermesProfileNotShared') and not uncertain then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 if target is null then return; end if;
 if ((target ~ '^co-[0-9a-f]{32}$' and not public.company_profile_ready(turn.company_id)) or refusal='agentLevelPending') and not uncertain then return; end if;
 if held.conversation_id is null then
  insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
   values(conversation,turn.send_key,turn.company_id,token,turn.person_id,turn.agent_id,turn.message,target)
   on conflict on constraint conversation_run_reservations_pkey do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null,
    start_attempts=0,start_unknown_at=null
    where public.conversation_run_reservations.abandoned_at is not null;
 end if;
 return query select turn.company_id,turn.agent_id,turn.person_id,turn.send_key,turn.message,token,target,
  public.pinned_run_note(conversation,turn.send_key,turn.company_id,turn.person_id),uncertain,
  exists(select 1 from public.conversation_attachments a where a.conversation_id=conversation and a.company_id=turn.company_id and a.send_key=turn.send_key);
end $function$;
revoke all on function public.claim_conversation_turn(uuid) from public,anon,authenticated;
grant execute on function public.claim_conversation_turn(uuid) to service_role;
