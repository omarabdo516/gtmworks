-- A claim reads the Conversation's open run and its next turn only after a start being recorded has ended (#70).
create or replace function public.claim_conversation_turn(conversation uuid)
returns table(company uuid, agent uuid, person uuid, send_key uuid, message text, connection uuid, note text, retry boolean)
language plpgsql security definer set search_path='' as $$
declare turn public.conversation_queued_turns; linked public.hermes_connections; held public.conversation_run_reservations; uncertain boolean;
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
 if held.conversation_id is not null then select * into linked from public.hermes_connections h where h.id=held.connection_id;
 else select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=turn.agent_id and a.company_id=turn.company_id;
 end if;
 -- A start that may have happened is never failed here: it waits for its own Connection to be usable again.
 if (linked.id is null or (linked.profile ~ '^co-[0-9a-f]{32}$' and linked.profile<>public.company_engine_profile(turn.company_id))) and not uncertain then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=turn.send_key; return;
 end if;
 if linked.id is null then return; end if;
 if linked.profile ~ '^co-[0-9a-f]{32}$' and not public.company_profile_ready(turn.company_id) and not uncertain then return; end if;
 if held.conversation_id is null then
  insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile)
   values(conversation,turn.send_key,turn.company_id,linked.id,turn.person_id,turn.agent_id,turn.message,linked.profile)
   on conflict on constraint conversation_run_reservations_pkey do update set connection_id=excluded.connection_id,profile=excluded.profile,message=excluded.message,created_at=now(),abandoned_at=null,
    start_attempts=0,start_unknown_at=null
    where public.conversation_run_reservations.abandoned_at is not null;
 end if;
 return query select turn.company_id,turn.agent_id,turn.person_id,turn.send_key,turn.message,linked.id,
  public.pinned_run_note(conversation,turn.send_key,turn.company_id,turn.person_id),uncertain;
end $$;
revoke all on function public.claim_conversation_turn(uuid) from public,anon,authenticated;
grant execute on function public.claim_conversation_turn(uuid) to service_role;
