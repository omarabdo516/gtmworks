create function public.guard_member_agent_role() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is not null and new.agent_role is distinct from old.agent_role and not public.can_assign_owner(new.company_id) then
  -- Role changes and invitation claims must release a key without assigning a new one.
  if new.agent_role is not null or (new.role='contributor' and not (old.removed_at is not null and new.removed_at is null)) then
   raise exception 'only an owner can change agent roles' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
create trigger member_agent_role_guard before insert or update on public.members for each row execute function public.guard_member_agent_role();

create or replace function public.claim_invitations() returns void language plpgsql security definer set search_path = '' as $$
declare inv public.member_invitations; mail text;
begin
 select email into mail from auth.users where id=auth.uid();
 if mail is null then return; end if;
 insert into public.people(id,name) values(auth.uid(),split_part(mail,'@',1)) on conflict(id) do nothing;
 for inv in select * from public.member_invitations where lower(email)=lower(mail) and claimed_at is null for update loop
  insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) values(inv.company_id,auth.uid(),inv.role,inv.grant_publishing,inv.grant_money_figures,inv.grant_customer_data) on conflict (company_id,person_id) do update set role=excluded.role, grant_publishing=excluded.grant_publishing, grant_money_figures=excluded.grant_money_figures, grant_customer_data=excluded.grant_customer_data, removed_at=null, agent_role=null where public.members.removed_at is not null;
  update public.member_invitations set claimed_at=now() where id=inv.id;
 end loop;
end $$;
revoke all on function public.claim_invitations() from public;
grant execute on function public.claim_invitations() to authenticated;
