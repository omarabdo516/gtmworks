-- #185 The Owner invites a Member from the Team table (design-reference: sendInvite, inviteErr, teamTableHTML). An open
-- invitation is a row of that table, with a switch per Agent kept with the invitation and applied when the person joins.
-- Every invitation writes one "invited a member" row to the Company log, read by the Owner and the Managers.
-- Additive: one table, one sequence, three functions, two triggers on member_invitations and a wider log source list.
-- The previous app version runs against it unchanged: its invitations (changeMember) keep working and now log too.

create table public.invitation_agent_access (
 company_id uuid not null,
 invitation_id uuid not null references public.member_invitations(id) on delete cascade,
 agent_id uuid not null references public.hermes_agents(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key (invitation_id, agent_id)
);
alter table public.invitation_agent_access enable row level security;
create policy invitation_agent_access_read on public.invitation_agent_access for select to authenticated using (public.can_manage_company(company_id));
revoke all on public.invitation_agent_access from anon,authenticated,service_role;
grant select on public.invitation_agent_access to authenticated;

-- One switch on an invited row, as set_agent_visible is on a Member's row. The invitation must still be open.
create function public.set_invitation_agent_visible(c uuid, invitation uuid, agent uuid, visible boolean) returns void language plpgsql security definer set search_path='' as $$
declare chosen public.hermes_agents; target public.member_invitations;
begin
 if visible is null or not public.can_manage_company(c) then raise exception 'agentVisibilityNotAllowed' using errcode='42501'; end if;
 select * into chosen from public.hermes_agents where id=agent and company_id=c and public.agent_visible_to(c,auth.uid(),agent);
 if not found then raise exception 'agentNotFound' using errcode='P0002'; end if;
 if chosen.is_default then raise exception 'mainAgentShownToAll' using errcode='42501'; end if;
 select * into target from public.member_invitations where id=invitation and company_id=c and claimed_at is null;
 if not found then raise exception 'invitationNotFound' using errcode='P0002'; end if;
 if target.role='owner' then raise exception 'ownerSeesEveryAgent' using errcode='42501'; end if;
 if visible then insert into public.invitation_agent_access(company_id,invitation_id,agent_id) values(c,invitation,agent) on conflict do nothing;
 else delete from public.invitation_agent_access where invitation_id=invitation and agent_id=agent;
 end if;
end;
$$;
revoke all on function public.set_invitation_agent_visible(uuid,uuid,uuid,boolean) from public,anon,service_role;
grant execute on function public.set_invitation_agent_visible(uuid,uuid,uuid,boolean) to authenticated;

-- The Owner's invitation, checked as the reference's inviteErr checks it: an empty email, one that is not an address,
-- and one already invited or already a Member here, in any letter case, are each refused with their own code. A closed
-- invitation of a person who has left is opened again. Returns the invitation's id.
create function public.invite_member(c uuid, mail text, member_role public.member_role) returns uuid language plpgsql security definer set search_path='' as $$
declare address text := lower(btrim(coalesce(mail,''), E' \t\r\n')); invitation uuid;
begin
 if not public.is_company_owner(c) then raise exception 'inviteNotAllowed' using errcode='42501'; end if;
 if address='' then raise exception 'inviteEmailEmpty' using errcode='22023'; end if;
 if address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then raise exception 'inviteEmailMalformed' using errcode='22P02'; end if;
 if member_role is null or member_role not in ('manager','contributor','viewer') then raise exception 'inviteRoleNotAllowed' using errcode='22004'; end if;
 perform pg_advisory_xact_lock(hashtextextended('invite:'||c::text||':'||address,0));
 if exists(select 1 from public.member_invitations where company_id=c and lower(email)=address and claimed_at is null)
  or exists(select 1 from public.members m join auth.users u on u.id=m.person_id where m.company_id=c and m.removed_at is null and lower(u.email)=address) then
  raise exception 'inviteEmailTaken' using errcode='23505'; end if;
 update public.member_invitations set email=address, role=member_role, grant_publishing=false, grant_money_figures=false, grant_customer_data=false, claimed_at=null, created_at=now()
  where id=(select id from public.member_invitations where company_id=c and lower(email)=address order by email=address desc, created_at desc limit 1)
  returning id into invitation;
 if invitation is null then
  insert into public.member_invitations(company_id,email,role) values(c,address,member_role) returning id into invitation;
 end if;
 return invitation;
end;
$$;
revoke all on function public.invite_member(uuid,text,public.member_role) from public,anon,service_role;
grant execute on function public.invite_member(uuid,text,public.member_role) to authenticated;

-- "invited a member" (design-reference: sendInvite's log line): who invited, the email and the Role, for the Owner and
-- the Managers. An invitation has no bigint id of its own, so its log rows take theirs from a sequence.
create sequence public.member_invitation_log_seq;
revoke all on sequence public.member_invitation_log_seq from public,anon,authenticated,service_role;
alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit','note_runs','reply_cards','member_invitations'));
create function public.log_member_invitation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(new.company_id,auth.uid(),public.log_actor_kind(new.company_id,auth.uid()),(select name from public.people where id=auth.uid()),
   'member','member_invited',jsonb_build_object('email',new.email,'role',new.role,'private','managers'),
   'member_invitations',nextval('public.member_invitation_log_seq'),now());
 return null;
end;
$$;
revoke all on function public.log_member_invitation() from public,anon,authenticated,service_role;
create trigger member_invitations_log_insert after insert on public.member_invitations for each row when (new.claimed_at is null) execute function public.log_member_invitation();
create trigger member_invitations_log_reopen after update of claimed_at on public.member_invitations for each row when (old.claimed_at is not null and new.claimed_at is null) execute function public.log_member_invitation();

-- Accepting: a person who joins or comes back through an invitation sees the Agents switched on for that invitation and
-- no other; the switches move to the Member's own rows. A Member already active keeps their own switches.
create or replace function public.claim_invitations() returns void language plpgsql security definer set search_path = '' as $$
declare inv public.member_invitations; mail text; joined boolean;
begin
 select email into mail from auth.users where id=auth.uid();
 if mail is null then return; end if;
 insert into public.people(id,name) values(auth.uid(),split_part(mail,'@',1)) on conflict(id) do nothing;
 for inv in select * from public.member_invitations where lower(email)=lower(mail) and claimed_at is null for update loop
  joined := false;
  insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) values(inv.company_id,auth.uid(),inv.role,inv.grant_publishing,inv.grant_money_figures,inv.grant_customer_data) on conflict (company_id,person_id) do update set role=excluded.role, grant_publishing=excluded.grant_publishing, grant_money_figures=excluded.grant_money_figures, grant_customer_data=excluded.grant_customer_data, removed_at=null, agent_role=null where public.members.removed_at is not null
   returning true into joined;
  if joined then
   delete from public.member_agent_access where company_id=inv.company_id and person_id=auth.uid();
   insert into public.member_agent_access(company_id,person_id,agent_id)
    select inv.company_id,auth.uid(),a.agent_id from public.invitation_agent_access a where a.invitation_id=inv.id
    on conflict do nothing;
  end if;
  delete from public.invitation_agent_access where invitation_id=inv.id;
  update public.member_invitations set claimed_at=now() where id=inv.id;
 end loop;
end $$;
revoke all on function public.claim_invitations() from public,anon;
grant execute on function public.claim_invitations() to authenticated;
