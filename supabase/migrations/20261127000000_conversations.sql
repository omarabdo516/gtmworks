-- A conversation is one person's private exchange with one agent; Hermes keeps the working session.
create table public.conversations (
 id uuid primary key,
 company_id uuid not null references public.companies(id),
 person_id uuid not null references public.people(id),
 agent_id uuid references public.hermes_agents(id) on delete set null,
 agent_name text not null,
 hermes_session_id text,
 created_at timestamptz not null default now(),
 unique(id,company_id)
);
alter table public.conversations enable row level security;
create policy conversations_read on public.conversations for select to authenticated using (person_id=auth.uid() and (public.is_member(company_id) or public.agency_access()));
revoke all on public.conversations from anon,authenticated,service_role;
grant select on public.conversations to authenticated;

-- The record as people saw it: append-only, one row per message, the agent's reply stored once per run.
create table public.conversation_messages (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 conversation_id uuid not null,
 author text not null check (author in ('person','agent')),
 person_id uuid references public.people(id),
 agent_id uuid,
 author_name text not null,
 body text not null check (length(body) between 1 and 200000),
 send_key uuid,
 run_id text not null,
 created_at timestamptz not null default now(),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id),
 check ((author='person')=(person_id is not null and send_key is not null)),
 unique(conversation_id,send_key),
 unique(conversation_id,author,run_id)
);
create index conversation_messages_order on public.conversation_messages(conversation_id,id);
alter table public.conversation_messages enable row level security;
create policy conversation_messages_read on public.conversation_messages for select to authenticated using (exists(select 1 from public.conversations c where c.id=conversation_id and c.company_id=conversation_messages.company_id and c.person_id=auth.uid() and (public.is_member(c.company_id) or public.agency_access())));
revoke all on public.conversation_messages from anon,authenticated,service_role;
grant select on public.conversation_messages to authenticated;

create function public.refuse_conversation_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'conversationAppendOnly' using errcode='42501'; end;
$$;
revoke all on function public.refuse_conversation_change() from public,anon,authenticated,service_role;
create trigger conversation_messages_append_only before update or delete on public.conversation_messages for each row execute function public.refuse_conversation_change();

-- Checked before Hermes is called: an id that is someone else's, or another company's, never reaches their Hermes session.
-- Returns the conversation's agent, or null when the id is not used yet.
create function public.conversation_agent(conversation uuid, c uuid) returns uuid language plpgsql stable security definer set search_path='' as $$
declare existing public.conversations;
begin
 if auth.uid() is null or not public.agency_access() then raise exception 'conversationAgencyOnly' using errcode='42501'; end if;
 select * into existing from public.conversations where id=conversation;
 if not found then return null; end if;
 if existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is null then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 return existing.agent_id;
end;
$$;
revoke all on function public.conversation_agent(uuid,uuid) from public,anon,service_role;
grant execute on function public.conversation_agent(uuid,uuid) to authenticated;

-- The person's message: only an Agency person writes, as themselves, in their own conversation; a repeated key stores nothing.
create function public.send_conversation_message(conversation uuid, c uuid, agent uuid, message text, message_key uuid, run text)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.conversations; chosen public.hermes_agents; writer text; saved bigint;
begin
 if auth.uid() is null or not public.agency_access() then raise exception 'conversationAgencyOnly' using errcode='42501'; end if;
 select * into chosen from public.hermes_agents where id=agent and company_id=c;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),agent,chosen.name) on conflict (id) do nothing;
 select * into existing from public.conversations where id=conversation;
 if existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is distinct from agent then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select name into writer from public.people where id=auth.uid();
 insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
  values(c,conversation,'person',auth.uid(),coalesce(writer,''),message,message_key,run) on conflict do nothing returning id into saved;
 return saved is not null;
end;
$$;
revoke all on function public.send_conversation_message(uuid,uuid,uuid,text,uuid,text) from public,anon,service_role;
grant execute on function public.send_conversation_message(uuid,uuid,uuid,text,uuid,text) to authenticated;

-- The agent's reply, read from Hermes by the conversation's own person: stored once, only for a run of one of their messages.
create function public.record_conversation_reply(conversation uuid, run text, reply text, hermes_session text) returns void language plpgsql security definer set search_path='' as $$
declare existing public.conversations;
begin
 if auth.uid() is null or not public.agency_access() then raise exception 'conversationAgencyOnly' using errcode='42501'; end if;
 select * into existing from public.conversations where id=conversation and person_id=auth.uid();
 if not found or not exists(select 1 from public.conversation_messages where conversation_id=conversation and author='person' and run_id=run) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
  values(existing.company_id,conversation,'agent',existing.agent_id,existing.agent_name,left(reply,200000),run) on conflict do nothing;
 update public.conversations set hermes_session_id=hermes_session where id=conversation and hermes_session_id is null and hermes_session is not null;
end;
$$;
revoke all on function public.record_conversation_reply(uuid,text,text,text) from public,anon,service_role;
grant execute on function public.record_conversation_reply(uuid,text,text,text) to authenticated;
