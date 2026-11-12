-- Any Member except a Viewer talks to the company's agents (#287); the Agency still may, after two-step verification.
-- A conversation stays readable only by its own person (the read policies are unchanged). Refusals keep their codes,
-- so the previous app version still answers them. Engine output and usage are still written only by the service-role
-- close_conversation_run; record_conversation_reply and record_conversation_run stay Agency-only, unchanged.
create function public.conversation_can_write(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (public.agency_access() or exists(select 1 from public.members where company_id=c and person_id=auth.uid() and removed_at is null and role<>'viewer'));
$$;
revoke all on function public.conversation_can_write(uuid) from public,anon,service_role;
grant execute on function public.conversation_can_write(uuid) to authenticated;

create or replace function public.conversation_agent(conversation uuid, c uuid) returns uuid language plpgsql stable security definer set search_path='' as $$
declare existing public.conversations;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into existing from public.conversations where id=conversation;
 if not found then return null; end if;
 if existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is null then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 return existing.agent_id;
end;
$$;

-- Finds a person's message by its run, for the check below (not unique: the Agency may reuse run ids).
create index conversation_messages_person_run on public.conversation_messages(run_id) where author='person';

create or replace function public.send_conversation_message(conversation uuid, c uuid, agent uuid, message text, message_key uuid, run text)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.conversations; chosen public.hermes_agents; writer text; saved bigint;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into chosen from public.hermes_agents where id=agent and company_id=c;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),agent,chosen.name) on conflict (id) do nothing;
 select * into existing from public.conversations where id=conversation;
 if existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is distinct from agent then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 -- A Member cannot register a run that belongs to another conversation: each copy would be closed again and its
 -- engine usage counted twice. The lock keeps two calls at once from both passing. A retry in the same conversation
 -- stays idempotent; the Agency's behaviour is unchanged.
 if not public.agency_access() then
  perform pg_advisory_xact_lock(hashtextextended('conversation_run:'||coalesce(run,''),0));
  if exists(select 1 from public.conversation_messages where author='person' and run_id=run and conversation_id<>conversation) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 end if;
 select name into writer from public.people where id=auth.uid();
 insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
  values(c,conversation,'person',auth.uid(),coalesce(writer,''),message,message_key,run) on conflict do nothing returning id into saved;
 return saved is not null;
end;
$$;

-- A Member cannot read Connections (RLS), so the server reads the agent's Connection with the service role: first the
-- agent, by id and the company the database accepted the sender in, then its Connection's non-secret fields and the key
-- it could already read (ADR 0008). An agent may use a Connection made in another company (manage_hermes_agent allows
-- sharing a profile), so the agent's company, not the Connection's, is the authority. Nothing else is granted.
grant select(id,company_id,connection_id) on public.hermes_agents to service_role;
grant select(address,profile,state,features) on public.hermes_connections to service_role;

-- A Member's run is read with the agent's own Connection, which an Agency owner attached to the company: the open run
-- carries that Connection whoever owns it (it no longer has to be the conversation's person).
create or replace function public.open_conversation_runs(just uuid default null, owner uuid default null, after bigint default 0)
returns table(message bigint, conversation uuid, run text, person uuid, connection uuid, address text, profile text, state text)
language sql stable security definer set search_path='' as $$
 select m.id,m.conversation_id,m.run_id,c.person_id,h.id,h.address,h.profile,h.state from public.conversation_messages m
 join public.conversations c on c.id=m.conversation_id left join public.hermes_agents a on a.id=c.agent_id and a.company_id=c.company_id
 left join public.hermes_connections h on h.id=a.connection_id
 where m.author='person' and m.id>after and (just is null or m.conversation_id=just) and (owner is null or c.person_id=owner)
  and not exists(select 1 from public.conversation_messages r where r.conversation_id=m.conversation_id and r.author='agent' and r.run_id=m.run_id)
  and not exists(select 1 from public.conversation_usage u where u.conversation_id=m.conversation_id and u.run_id=m.run_id)
 order by m.id limit 500;
$$;
