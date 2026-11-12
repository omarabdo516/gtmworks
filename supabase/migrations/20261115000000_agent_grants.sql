-- An agent is one named role identity shared by every company. A company grant lets it work in one company;
-- no active grant row means no access, and revoking keeps the row with who revoked it and when (ADR 0006).
create table public.agents (
 id uuid primary key references public.people(id), role text not null unique check (role in ('account_manager','writer','designer','critic')), created_at timestamptz not null default now()
);
create table public.agent_grants (
 company_id uuid not null references public.companies(id), agent_id uuid not null references public.agents(id),
 granted_by uuid references public.people(id), granted_at timestamptz not null default now(),
 revoked_by uuid references public.people(id), revoked_at timestamptz,
 primary key (company_id, agent_id),
 constraint agent_grants_revocation check ((revoked_at is null) = (revoked_by is null))
);
alter table public.agents enable row level security;
alter table public.agent_grants enable row level security;
create policy agents_read on public.agents for select to authenticated using (true);
create policy agent_grants_read on public.agent_grants for select to authenticated using (public.can_manage_company(company_id));
-- Only the two functions below change grants; clients get read access only.
revoke all on public.agents, public.agent_grants from public, anon, authenticated;
grant select on public.agents, public.agent_grants to authenticated;

-- The role is text with the same four keys, so the agent-role backfill test can still drop and recreate the enum.
-- Existing role holders become agents; the lowest person id keeps a role that two companies filled differently.
insert into public.agents(id, role)
 select distinct on (m.agent_role) m.person_id, m.agent_role::text from public.members m where m.agent_role is not null and m.removed_at is null order by m.agent_role, m.person_id;
-- Every company where the agent person is an active member keeps working, whatever role key that membership carries.
insert into public.agent_grants(company_id, agent_id)
 select m.company_id, a.id from public.members m join public.agents a on a.id = m.person_id where m.removed_at is null;

-- A key of a shared role agent resolves only while that agent holds an active grant in the key's company. Keys of other contributors keep working unchanged (the documented legacy transition, ADR 0006).
create or replace function public.lookup_agent_key(hash text) returns table(key_id uuid, company_id uuid, person_id uuid, slug text) language plpgsql security definer set search_path='' as $$
begin
 return query update public.agent_keys k set last_used_at=now() from public.members m, public.companies c where k.key_hash=hash and k.revoked_at is null and m.company_id=k.company_id and m.person_id=k.person_id and m.removed_at is null and m.role='contributor' and c.id=k.company_id and (not exists(select 1 from public.agents a where a.id=k.person_id) or exists(select 1 from public.agent_grants g where g.company_id=k.company_id and g.agent_id=k.person_id and g.revoked_at is null)) returning k.id,k.company_id,k.person_id,c.slug;
end $$;
-- The API answers 404, not 401, for a live key whose grant is gone.
create function public.agent_key_denied(hash text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agent_keys k where k.key_hash=hash and k.revoked_at is null and exists(select 1 from public.agents a where a.id=k.person_id) and not exists(select 1 from public.agent_grants g where g.company_id=k.company_id and g.agent_id=k.person_id and g.revoked_at is null));
$$;
revoke all on function public.agent_key_denied(text) from public, anon, authenticated;
grant execute on function public.agent_key_denied(text) to service_role;

-- Database enforcement: a shared role agent can be an active member of a company only while it holds an active grant there. This also
-- stops an invitation claim from restoring the membership of a revoked agent.
create function public.agent_membership_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.removed_at is null and (tg_op='INSERT' or old.removed_at is not null) and exists(select 1 from public.agents a where a.id=new.person_id)
  and not exists(select 1 from public.agent_grants g where g.company_id=new.company_id and g.agent_id=new.person_id and g.revoked_at is null) then
  raise exception 'agent has no active grant in this company' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.agent_membership_guard() from public, anon, authenticated;
create trigger agent_membership_guard before insert or update on public.members for each row execute function public.agent_membership_guard();

-- Granting makes the agent an active Contributor of the company, so every row policy applies to it; revoking removes that membership.
create function public.grant_agent_access(c uuid, a uuid) returns void language plpgsql security definer set search_path='' as $$
declare found_agent public.agents%rowtype; begin
 if auth.uid() is null or not public.can_assign_owner(c) then raise exception 'not permitted to grant agent access' using errcode='42501'; end if;
 select * into found_agent from public.agents where id=a;
 if not found then raise exception 'agent not found'; end if;
 insert into public.agent_grants(company_id,agent_id,granted_by) values (c,a,auth.uid())
  on conflict (company_id,agent_id) do update set granted_by=auth.uid(), granted_at=now(), revoked_by=null, revoked_at=null;
 insert into public.members(company_id,person_id,role,agent_role) values (c,a,'contributor',found_agent.role::public.member_agent_role)
  on conflict (company_id,person_id) do update set role='contributor', agent_role=excluded.agent_role, removed_at=null;
 insert into public.member_audit(company_id,actor_id,actor_name,person_id,person_name,action,after_data) values (c,auth.uid(),(select name from public.people where id=auth.uid()),a,(select name from public.people where id=a),'GRANT_AGENT',jsonb_build_object('agent_role',found_agent.role));
end $$;
create function public.revoke_agent_access(c uuid, a uuid) returns void language plpgsql security definer set search_path='' as $$
declare found_agent public.agents%rowtype; begin
 if auth.uid() is null or not public.can_assign_owner(c) then raise exception 'not permitted to revoke agent access' using errcode='42501'; end if;
 update public.agent_grants set revoked_at=now(), revoked_by=auth.uid() where company_id=c and agent_id=a and revoked_at is null;
 if not found then raise exception 'grant not found'; end if;
 update public.members set removed_at=now() where company_id=c and person_id=a and removed_at is null;
 select * into found_agent from public.agents where id=a;
 insert into public.member_audit(company_id,actor_id,actor_name,person_id,person_name,action,before_data) values (c,auth.uid(),(select name from public.people where id=auth.uid()),a,(select name from public.people where id=a),'REVOKE_AGENT',jsonb_build_object('agent_role',found_agent.role));
end $$;
revoke all on function public.grant_agent_access(uuid,uuid) from public, anon;
revoke all on function public.revoke_agent_access(uuid,uuid) from public, anon;
grant execute on function public.grant_agent_access(uuid,uuid) to authenticated;
grant execute on function public.revoke_agent_access(uuid,uuid) to authenticated;
