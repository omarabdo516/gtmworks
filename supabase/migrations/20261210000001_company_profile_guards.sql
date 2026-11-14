-- Guards on the Company profiles of ADR 0014 (review of 20261210000000).
--
-- A Company's own profile serves that Company only. An Owner of two Companies could attach one Company's Connection to
-- the other's Agent after the sharing warning (manage_hermes_agent), so the other Company's members would run on its
-- memory and sign-in. A Connection naming a Company profile (`co-<company id>`) is now refused for any other Company,
-- in hermes_connections and in hermes_agents, whoever writes them, and again when a Run is reserved.
--
-- A Run is reserved before Hermes is called. sendMessage used to start the Run and only then record it, so a move to
-- the Company's profile could pass its "no open Run" check in between and the Run would be read on the wrong profile.
-- reserve_conversation_run pins the Agent's Connection under the same lock as the move; the move waits while a
-- reservation younger than ten minutes holds one of its Connections, and recording the message ends the reservation.
--
-- A Run on a Company profile starts only while the profile's tools are those of the Company's level
-- (company_profile_ready): a level change the worker could not apply yet, or a profile the Engine lost, stops new Runs
-- instead of letting them run with the old tools.
--
-- Nothing existing is rewritten. The previous app version still records messages without a reservation.

create function public.guard_company_profile_connection() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.profile ~ '^co-[0-9a-f]{32}$' and new.profile<>public.company_engine_profile(new.company_id) then raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_company_profile_connection() from public,anon,authenticated,service_role;
create trigger company_profile_connection before insert or update of profile,company_id on public.hermes_connections for each row execute function public.guard_company_profile_connection();

create function public.guard_company_profile_agent() returns trigger language plpgsql security definer set search_path='' as $$
declare named text;
begin
 select profile into named from public.hermes_connections where id=new.connection_id;
 if named ~ '^co-[0-9a-f]{32}$' and named<>public.company_engine_profile(new.company_id) then raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_company_profile_agent() from public,anon,authenticated,service_role;
create trigger company_profile_agent before insert or update of connection_id,company_id on public.hermes_agents for each row execute function public.guard_company_profile_agent();

create table public.conversation_run_reservations (
 conversation_id uuid not null,
 send_key uuid not null,
 company_id uuid not null references public.companies(id),
 connection_id uuid not null references public.hermes_connections(id) on delete cascade,
 person_id uuid not null references public.people(id),
 created_at timestamptz not null default now(),
 primary key (conversation_id,send_key)
);
alter table public.conversation_run_reservations enable row level security;
revoke all on public.conversation_run_reservations from anon,authenticated,service_role;

-- The sender's own session reserves the Run and learns which Connection it must start on.
create function public.reserve_conversation_run(conversation uuid, c uuid, agent uuid, message_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing public.conversations; linked public.hermes_connections; pinned uuid;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into existing from public.conversations where id=conversation;
 if found and (existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is distinct from agent) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 -- The lock of agent assignments and moves: no move passes between this read and the reservation.
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select h.* into linked from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id where a.id=agent and a.company_id=c;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if linked.profile ~ '^co-[0-9a-f]{32}$' then
  if linked.profile<>public.company_engine_profile(c) then raise exception 'hermesProfileNotShared' using errcode='42501'; end if;
  if not public.company_profile_ready(c) then raise exception 'agentLevelPending' using errcode='55000'; end if;
 end if;
 -- A retry keeps the Connection it first reserved, so it never starts a second Run on another profile.
 insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id) values(conversation,message_key,c,linked.id,auth.uid())
  on conflict (conversation_id,send_key) do update set created_at=now() returning connection_id into pinned;
 return pinned;
end $$;
revoke all on function public.reserve_conversation_run(uuid,uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.reserve_conversation_run(uuid,uuid,uuid,uuid) to authenticated;

-- Recording the message ends its reservation (the open Run now holds the move instead).
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
 -- stays idempotent.
 perform pg_advisory_xact_lock(hashtextextended('conversation_run:'||coalesce(run,''),0));
 if exists(select 1 from public.conversation_messages where author='person' and run_id=run and conversation_id<>conversation) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select name into writer from public.people where id=auth.uid();
 insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
  values(c,conversation,'person',auth.uid(),coalesce(writer,''),message,message_key,run) on conflict do nothing returning id into saved;
 delete from public.conversation_run_reservations where conversation_id=conversation and send_key=message_key;
 return saved is not null;
end;
$$;

-- The move also waits for reservations of its Connections.
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
 if exists(select 1 from public.conversation_run_reservations r where r.connection_id=any(olds) and r.created_at>now()-interval '10 minutes')
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
  delete from public.hermes_connections h where h.id=old and not exists(select 1 from public.hermes_agents a where a.connection_id=old);
 end loop;
 return moved;
end $$;
revoke all on function public.move_company_profile(uuid,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.move_company_profile(uuid,text,text,text,text[]) to service_role;
