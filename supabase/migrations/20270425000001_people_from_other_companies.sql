-- #952's migration moved from 20270425000000 to 20270425000001: #960's conversation_list_from_engine took that version first
-- and neither had reached a release, so both apply now.
-- #952, ADR 0019: a Person who already has an account joins by an Invite link by signing in on its page, instead of
-- making a second account, and an Administrator adds a Person who is a Member of another Company they administer from
-- the Team page, with a Role and Agents and no link. Neither path changes a Person who is already an active Member
-- (#775). Additive: three functions, and the claim learns the name of an account made before this release that has no
-- Person row yet, from its email.
--
-- A Person's account and their Person row were always made together by gtmworks (first run, a first-Owner link, an
-- Invite link), but an account from the email invitation this release replaces may have one without the other. Signing
-- in with it must still join, so the claim names it from its email as claim_invitations does.

-- The people an Administrator may add without a link (#952), for the Team page: the active Members of another Company
-- they administer, who are not already active Members of this Company, with the Company each one comes from. A Manager,
-- or anyone who does not administer this Company, reads none.
create function public.company_addable_people(c uuid) returns table(person_id uuid, name text, company text)
language sql stable security definer set search_path='' as $function$
 select p.id, p.name, x.company from (
  select distinct on (m.person_id) m.person_id, co.name as company
  from public.members m join public.companies co on co.id=m.company_id
  where public.is_company_owner(c) and m.removed_at is null and m.company_id<>c and public.is_company_owner(m.company_id)
   and not exists(select 1 from public.members here where here.company_id=c and here.person_id=m.person_id and here.removed_at is null)
  order by m.person_id, co.name
 ) x join public.people p on p.id=x.person_id
 order by p.name, p.id;
$function$;
revoke all on function public.company_addable_people(uuid) from public,anon,service_role;
grant execute on function public.company_addable_people(uuid) to authenticated;

-- Adding a Person from another Company (#952): the Administrator names a Person who is an active Member of another
-- Company they administer, with a Role that is never Administrator and the Agents they will see here. An active Member
-- of this Company is refused and nothing changes (#775). The Member insert is the one the members trigger already
-- writes in the Company log, by its Administrator.
create function public.add_company_member(c uuid, person uuid, member_role text, agents uuid[]) returns void
language plpgsql security definer set search_path='' as $function$
declare joined boolean; chosen uuid; agent public.hermes_agents;
begin
 if c is null or not public.is_company_owner(c) then raise exception 'memberAddNotAllowed' using errcode='42501'; end if;
 if member_role is null or member_role not in ('manager','contributor','viewer') then raise exception 'memberRoleNotAllowed' using errcode='22023'; end if;
 if person is null then raise exception 'invalidPerson' using errcode='22023'; end if;
 if exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.removed_at is null) then
  raise exception 'alreadyMember' using errcode='23505';
 end if;
 if not exists(select 1 from public.members m where m.person_id=person and m.removed_at is null and m.company_id<>c
  and public.is_company_owner(m.company_id)) then
  raise exception 'memberNotFromAdminCompany' using errcode='42501';
 end if;
 foreach chosen in array coalesce(agents,'{}'::uuid[]) loop
  select * into agent from public.hermes_agents a where a.id=chosen and a.company_id=c;
  if not found then raise exception 'agentNotFound' using errcode='P0002'; end if;
  if agent.is_default then raise exception 'mainAgentShownToAll' using errcode='42501'; end if;
 end loop;
 insert into public.members(company_id,person_id,role) values(c,person,member_role::public.member_role)
  on conflict (company_id,person_id) do update set role=excluded.role,grant_publishing=false,grant_money_figures=false,grant_customer_data=false,removed_at=null
  where public.members.removed_at is not null
  returning true into joined;
 if joined is not true then raise exception 'alreadyMember' using errcode='23505'; end if;
 delete from public.member_agent_access where company_id=c and person_id=person;
 insert into public.member_agent_access(company_id,person_id,agent_id)
  select c,person,x from unnest(coalesce(agents,'{}'::uuid[])) x on conflict do nothing;
end $function$;
revoke all on function public.add_company_member(uuid,uuid,text,uuid[]) from public,anon,service_role;
grant execute on function public.add_company_member(uuid,uuid,text,uuid[]) to authenticated;

-- Whether a Person who is signed in is an active Member of the Company behind an open Invite link (#952), so its page
-- says they are already in without spending the link. Only the server asks it.
create function public.invite_link_member(link_hash text, person uuid) returns boolean
language sql stable security definer set search_path='' as $function$
 select exists(
  select 1 from public.company_links l
  join public.members m on m.company_id=l.company_id and m.person_id=person and m.removed_at is null
  where l.secret_hash=link_hash and l.kind='invite' and l.used_at is null and l.cancelled_at is null and l.ends_at>now()
 );
$function$;
revoke all on function public.invite_link_member(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.invite_link_member(text,uuid) to service_role;

-- Sending an Invite link's form (#950) with an account that has no Person row yet names that Person from the email the
-- account was made with, as claim_invitations does, rather than refusing the join. A form that brings a name and language
-- for a new account is unchanged.
create or replace function public.claim_invite_link(link_hash text, person uuid, person_name text, language text) returns text
language plpgsql security definer set search_path='' as $function$
declare link public.company_links; joined boolean; slug text;
begin
 if link_hash is null or link_hash !~ '^[a-f0-9]{64}$' then raise exception 'inviteLinkInvalid' using errcode='55000'; end if;
 select l.* into link from public.company_links l where l.secret_hash=link_hash and l.kind='invite' for update;
 if not found or link.used_at is not null then raise exception 'inviteLinkUsed' using errcode='55000'; end if;
 if link.cancelled_at is not null then raise exception 'inviteLinkCancelled' using errcode='55000'; end if;
 if link.ends_at<=now() then raise exception 'inviteLinkEnded' using errcode='55000'; end if;
 if person is null then raise exception 'invalidPerson' using errcode='22023'; end if;
 if not exists(select 1 from public.people p where p.id=person) then
  if person_name is null then
   select split_part(u.email,'@',1) into person_name from auth.users u where u.id=person;
   language:=coalesce(language,'en');
  end if;
  if person_name is null or length(btrim(person_name)) not between 1 and 120 or language is null or language not in ('en','ar') then
   raise exception 'invalidPerson' using errcode='22023';
  end if;
  insert into public.people(id,name,language) values(person,btrim(person_name),language);
 end if;
 insert into public.members(company_id,person_id,role) values(link.company_id,person,link.role::public.member_role)
  on conflict (company_id,person_id) do update set role=excluded.role,grant_publishing=false,grant_money_figures=false,grant_customer_data=false,removed_at=null
  where public.members.removed_at is not null
  returning true into joined;
 if joined is not true then raise exception 'alreadyMember' using errcode='23505'; end if;
 delete from public.member_agent_access where company_id=link.company_id and person_id=person;
 insert into public.member_agent_access(company_id,person_id,agent_id)
  select link.company_id,person,a.agent_id from public.company_link_agents a where a.link_id=link.id on conflict do nothing;
 update public.company_links set used_at=now(),used_by=person where id=link.id;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,person_id,action,details,source,source_id,created_at)
  values(link.company_id,person,'person',(select name from public.people where id=person),'member',person,'invite_link_used',
   jsonb_build_object('label',link.label,'role',link.role,'person_name',(select name from public.people where id=person)),'company_links',nextval('public.company_link_log_seq'),now());
 select c.slug into slug from public.companies c where c.id=link.company_id;
 return slug;
end $function$;
