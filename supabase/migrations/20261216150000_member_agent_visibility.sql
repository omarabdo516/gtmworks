-- Which Agents each Member sees (#15; reference: the Member × Agent switches in Company settings, teamTableHTML). A row
-- allows one Member one Agent. The main Agent is shown to every Member and the Owner sees every Agent, so neither ever
-- has a row; any other Agent is absent for a Member without one: its row, its Conversations and its log rows.
-- Only Owners and Managers change the rows, through set_agent_visible. Safe to run again: the backfill test replays it.
create table if not exists public.member_agent_access (
 company_id uuid not null,
 person_id uuid not null,
 agent_id uuid not null references public.hermes_agents(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key (company_id, person_id, agent_id),
 foreign key (company_id, person_id) references public.members(company_id, person_id) on delete cascade
);
alter table public.member_agent_access enable row level security;
drop policy if exists member_agent_access_read on public.member_agent_access;
create policy member_agent_access_read on public.member_agent_access for select to authenticated
 using ((person_id=auth.uid() and public.is_member(company_id)) or public.can_manage_company(company_id));
revoke all on public.member_agent_access from anon,authenticated,service_role;
grant select on public.member_agent_access to authenticated;

-- An id that is not one of the Company's Agents (a person, a removed Agent) hides nothing.
create or replace function public.agent_visible_to(c uuid, person uuid, agent uuid) returns boolean language sql stable security definer set search_path='' as $$
 select agent is null
  or not exists(select 1 from public.hermes_agents h where h.id=agent and h.company_id=c and not h.is_default)
  or exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.removed_at is null and m.role='owner')
  or exists(select 1 from public.member_agent_access a where a.company_id=c and a.person_id=person and a.agent_id=agent);
$$;
revoke all on function public.agent_visible_to(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.agent_visible_to(uuid,uuid,uuid) to authenticated;

alter policy hermes_agents_read on public.hermes_agents using (public.is_member(company_id) and public.agent_visible_to(company_id,auth.uid(),id));
alter policy hermes_agent_audit_read on public.hermes_agent_audit using (public.is_member(company_id) and public.agent_visible_to(company_id,auth.uid(),agent_id));
alter policy conversations_read on public.conversations using (person_id=auth.uid() and public.is_member(company_id) and public.agent_visible_to(company_id,auth.uid(),agent_id));
alter policy company_log_read on public.company_log using (public.is_member(company_id) and public.agent_visible_to(company_id,auth.uid(),agent_id) and public.agent_visible_to(company_id,auth.uid(),actor_id));

-- Every way a person reaches an Agent writes one of these rows first (a new Conversation, a reserved run, a queued
-- turn): an Agent hidden from that person is not found, as if its address did not exist. The worker (service_role) only
-- finishes a turn the person sent while the Agent was still shown.
create or replace function public.refuse_hidden_agent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)='authenticated' and not public.agent_visible_to(new.company_id,new.person_id,new.agent_id) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 return new;
end;
$$;
revoke all on function public.refuse_hidden_agent() from public,anon,authenticated,service_role;
drop trigger if exists conversations_visible_agent on public.conversations;
create trigger conversations_visible_agent before insert on public.conversations for each row execute function public.refuse_hidden_agent();
drop trigger if exists conversation_run_reservations_visible_agent on public.conversation_run_reservations;
create trigger conversation_run_reservations_visible_agent before insert on public.conversation_run_reservations for each row execute function public.refuse_hidden_agent();
drop trigger if exists conversation_queued_turns_visible_agent on public.conversation_queued_turns;
create trigger conversation_queued_turns_visible_agent before insert on public.conversation_queued_turns for each row execute function public.refuse_hidden_agent();

create or replace function public.set_agent_visible(c uuid, person uuid, agent uuid, visible boolean) returns void language plpgsql security definer set search_path='' as $$
declare chosen public.hermes_agents; target public.members;
begin
 if visible is null or not public.can_manage_company(c) then raise exception 'agentVisibilityNotAllowed' using errcode='42501'; end if;
 select * into chosen from public.hermes_agents where id=agent and company_id=c;
 if not found then raise exception 'agentNotFound' using errcode='P0002'; end if;
 if chosen.is_default then raise exception 'mainAgentShownToAll' using errcode='42501'; end if;
 select * into target from public.members where company_id=c and person_id=person and removed_at is null;
 if not found then raise exception 'memberNotFound' using errcode='P0002'; end if;
 if target.role='owner' then raise exception 'ownerSeesEveryAgent' using errcode='42501'; end if;
 if visible then insert into public.member_agent_access(company_id,person_id,agent_id) values(c,person,agent) on conflict do nothing;
 else delete from public.member_agent_access where company_id=c and person_id=person and agent_id=agent;
 end if;
end;
$$;
revoke all on function public.set_agent_visible(uuid,uuid,uuid,boolean) from public,anon,service_role;
grant execute on function public.set_agent_visible(uuid,uuid,uuid,boolean) to authenticated;

-- Until now every Member saw every Agent: the Members of an existing Company keep seeing the Agents it has today.
insert into public.member_agent_access(company_id,person_id,agent_id)
 select m.company_id,m.person_id,h.id from public.members m join public.hermes_agents h on h.company_id=m.company_id
 where m.removed_at is null and m.role<>'owner' and not h.is_default
 on conflict do nothing;
