-- A run is closed once, by the worker or by a person reading their conversation, with one conversation_usage row
-- (#245) saying how it ended (completed, stopped, lost or failed) and what Hermes reported it used; a completed run
-- also stores its reply. Until then the run is open.

-- The runs gtmworks has not closed yet (all of them for the worker; one conversation of one person for a reader), with
-- the conversation's person and the agent's Connection (only one that person owns; its key is read separately by id and
-- owner, ADR 0008), so each is read from Hermes with that person's key. A detached agent has no Connection. Read in
-- pages after the last message id seen, so runs that stay open cannot hide newer ones.
create function public.open_conversation_runs(just uuid default null, owner uuid default null, after bigint default 0)
returns table(message bigint, conversation uuid, run text, person uuid, connection uuid, address text, profile text, state text)
language sql stable security definer set search_path='' as $$
 select m.id,m.conversation_id,m.run_id,c.person_id,h.id,h.address,h.profile,h.state from public.conversation_messages m
 join public.conversations c on c.id=m.conversation_id left join public.hermes_agents a on a.id=c.agent_id
 left join public.hermes_connections h on h.id=a.connection_id and h.agency_owner_id=c.person_id
 where m.author='person' and m.id>after and (just is null or m.conversation_id=just) and (owner is null or c.person_id=owner)
  and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
  and not exists(select 1 from public.conversation_usage u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)
 order by m.id limit 500;
$$;
revoke all on function public.open_conversation_runs(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.open_conversation_runs(uuid,uuid,bigint) to service_role;

-- Closes one run once: a second close, from the worker or a reader at the same moment, stores nothing and says so.
-- Usage goes first, so the reply's own trigger finds the run already recorded with what Hermes reported.
create function public.close_conversation_run(conversation uuid, run text, run_outcome text, reply text, hermes_session text, used_input bigint, used_output bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.conversations; known boolean := used_input is not null and used_output is not null; closed text;
begin
 if run_outcome is null or run_outcome not in ('completed','stopped','lost','failed') or run_outcome='completed' and coalesce(btrim(reply),'')='' then raise exception 'conversationFailed' using errcode='22023'; end if;
 select * into existing from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages where conversation_id=conversation and author='person' and run_id=run) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 insert into public.conversation_usage(company_id,conversation_id,run_id,outcome,input_tokens,output_tokens)
  values(existing.company_id,conversation,run,run_outcome,case when known then used_input end,case when known then used_output end)
  on conflict do nothing returning run_id into closed;
 if closed is null then return false; end if;
 if run_outcome='completed' then
  insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
   values(existing.company_id,conversation,'agent',existing.agent_id,existing.agent_name,left(reply,200000),run) on conflict do nothing;
  update public.conversations set hermes_session_id=hermes_session where id=conversation and hermes_session_id is null and hermes_session is not null;
 end if;
 return true;
end;
$$;
revoke all on function public.close_conversation_run(uuid,text,text,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.close_conversation_run(uuid,text,text,text,text,bigint,bigint) to service_role;
