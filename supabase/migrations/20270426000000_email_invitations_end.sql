-- #953, ADR 0019, first step (ADR 0023): an email invitation carries an end, and the claim, the channel readers and the
-- owner guard skip an ended one. Nothing is taken away here: the release this one replaces still makes and claims email
-- invitations during the update, and every row it writes has ended_at null. The cutover
-- (20270426000001_email_invitations_end_cutover.sql) ends the invitations left pending, closes the maker and the table
-- once this release serves.
alter table public.member_invitations add column if not exists ended_at timestamptz;

-- The first run's team step makes every named Person's link in one call, so a failure leaves no link made without its
-- secret shown. Each row is the Team page's own make_invite_link, and one failed row rolls back the whole batch.
create or replace function public.make_invite_links(c uuid, labels text[], link_roles text[], hashes text[]) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare i int; made uuid[]:='{}';
begin
 if labels is null or cardinality(labels)>50
  or cardinality(labels) is distinct from cardinality(link_roles)
  or cardinality(labels) is distinct from cardinality(hashes) then
  raise exception 'inviteLinkInvalid' using errcode='22023'; end if;
 for i in 1..cardinality(labels) loop
  made:=made||public.make_invite_link(c,labels[i],link_roles[i],'{}'::uuid[],hashes[i]);
 end loop;
 return made;
end $$;
revoke all on function public.make_invite_links(uuid,text[],text[],text[]) from public,anon,service_role;
grant execute on function public.make_invite_links(uuid,text[],text[],text[]) to authenticated;

-- 20270108000000's claim, and an invitation ended by this migration is never claimed. It stays for the channel invitee
-- rows a Company already holds and for a Member restored through one; no app path reaches it (app/auth/accept shows the
-- ended page, and the Team table makes links).
create or replace function public.claim_invitations() returns void language plpgsql security definer set search_path = '' as $$
declare inv public.member_invitations; mail text; joined boolean;
begin
 select email into mail from auth.users where id=auth.uid();
 if mail is null then return; end if;
 insert into public.people(id,name) values(auth.uid(),split_part(mail,'@',1)) on conflict(id) do nothing;
 for inv in select * from public.member_invitations where lower(email)=lower(mail) and claimed_at is null and ended_at is null for update loop
  joined := false;
  insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) values(inv.company_id,auth.uid(),inv.role,inv.grant_publishing,inv.grant_money_figures,inv.grant_customer_data) on conflict (company_id,person_id) do update set role=excluded.role, grant_publishing=excluded.grant_publishing, grant_money_figures=excluded.grant_money_figures, grant_customer_data=excluded.grant_customer_data, removed_at=null where public.members.removed_at is not null
   returning true into joined;
  if joined then
   delete from public.member_agent_access where company_id=inv.company_id and person_id=auth.uid();
   insert into public.member_agent_access(company_id,person_id,agent_id)
    select inv.company_id,auth.uid(),a.agent_id from public.invitation_agent_access a where a.invitation_id=inv.id
    on conflict do nothing;
  end if;
  insert into public.channel_people(channel_id, company_id, person_id, joined_through, added_by)
   select i.channel_id, i.company_id, auth.uid(), coalesce((select max(m.id) from public.channel_messages m where m.channel_id=i.channel_id),0), i.added_by
   from public.channel_invitees i where i.invitation_id=inv.id
   on conflict (channel_id, person_id) do nothing;
  delete from public.channel_invitees where invitation_id=inv.id;
  delete from public.invitation_agent_access where invitation_id=inv.id;
  update public.member_invitations set claimed_at=now() where id=inv.id;
 end loop;
end $$;

-- An ended invitation is not a pending Member of a channel, and no channel takes one.
create or replace function public.channel_members(ch uuid) returns table(person uuid, name text, role text, invitation uuid, email text)
language sql stable security definer set search_path='' as $$
 select * from (
  select m.person_id as person, p.name, m.role::text as role, null::uuid as invitation, null::text as email
  from public.channels k
   join public.members m on m.company_id=k.company_id
   join public.people p on p.id=m.person_id
  where k.id=ch and public.in_channel(ch) and public.channel_member(ch, m.person_id)
  union all
  select null::uuid as person, public.invitee_name(v.email) as name, v.role::text as role, v.id as invitation,
         case when public.can_manage_company(k.company_id) then v.email end as email
  from public.channels k
   join public.member_invitations v on v.company_id=k.company_id and v.claimed_at is null and v.ended_at is null
  where k.id=ch and public.in_channel(ch)
   and (k.kind='general' or exists(select 1 from public.channel_invitees i where i.channel_id=k.id and i.invitation_id=v.id))
   and not exists(select 1 from public.members m join auth.users u on u.id=m.person_id
    where m.company_id=k.company_id and m.removed_at is null and lower(u.email)=lower(v.email))
 ) rows
 order by case role when 'owner' then 0 when 'manager' then 1 when 'contributor' then 2 else 3 end, name, person nulls last, invitation;
$$;

create or replace function public.set_channel_invitee(ch uuid, invitation uuid, present boolean) returns void
language plpgsql security definer set search_path='' as $$
declare k public.channels; open_invite public.member_invitations;
begin
 select * into k from public.channels where id=ch;
 if k.id is null or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.can_manage_company(k.company_id) or k.kind<>'team' then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if present is null or invitation is null then raise exception 'channelFailed' using errcode='22023'; end if;
 if not present then delete from public.channel_invitees where channel_id=ch and invitation_id=invitation; return; end if;
 select * into open_invite from public.member_invitations v
  where v.id=invitation and v.company_id=k.company_id and v.claimed_at is null and v.ended_at is null for share;
 if open_invite.id is null then raise exception 'memberNotFound' using errcode='P0002'; end if;
 insert into public.channel_invitees(channel_id, company_id, invitation_id, added_by) values (ch, k.company_id, invitation, auth.uid())
  on conflict (channel_id, invitation_id) do nothing;
end $$;

create or replace function public.create_channel_inviting(c uuid, request_key uuid, channel_name text, people uuid[], agents uuid[], invitees uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare made public.channels; called text; chosen uuid; open_invite public.member_invitations;
begin
 if auth.uid() is null or not public.can_manage_company(c) or exists(select 1 from public.companies where id=c and work_mode='alone') then
  raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if request_key is null then raise exception 'channelFailed' using errcode='22023'; end if;
 select * into made from public.channels where company_id=c and create_key=request_key;
 if made.id is not null then
  if made.created_by is distinct from auth.uid() then raise exception 'channelFailed' using errcode='22023'; end if;
  return made.id;
 end if;
 called := regexp_replace(regexp_replace(coalesce(channel_name,''), '[[:space:]]+$', ''), '^[#[:space:]]+', '');
 if called = '' then raise exception 'channelNameMissing' using errcode='22023'; end if;
 if length(called) > 32 then raise exception 'channelNameTooLong' using errcode='22023'; end if;
 if lower(called) in ('general','عام') or exists(select 1 from public.channels where company_id=c and kind='team' and lower(name)=lower(called)) then
  raise exception 'channelNameTaken' using errcode='23505'; end if;
 if exists(select 1 from unnest(coalesce(people,'{}')) p where not public.channel_person(c, p)) then
  raise exception 'memberNotFound' using errcode='P0002'; end if;
 for chosen in select distinct unnest(coalesce(invitees,'{}')) loop
  select * into open_invite from public.member_invitations v
   where v.id=chosen and v.company_id=c and v.claimed_at is null and v.ended_at is null for share;
  if open_invite.id is null then raise exception 'memberNotFound' using errcode='P0002'; end if;
 end loop;
 if exists(select 1 from unnest(coalesce(agents,'{}')) a where not exists(select 1 from public.hermes_agents h where h.company_id=c and h.id=a)
  or not public.agent_visible_to(c, auth.uid(), a)) then
  raise exception 'agentNotFound' using errcode='P0002'; end if;
 begin
  insert into public.channels(company_id, kind, name, created_by, create_key) values (c, 'team', called, auth.uid(), request_key) returning * into made;
 exception when unique_violation then
  select * into made from public.channels where company_id=c and create_key=request_key and created_by=auth.uid();
  if made.id is not null then return made.id; end if;
  raise exception 'channelNameTaken' using errcode='23505';
 end;
 insert into public.channel_people(channel_id, company_id, person_id, added_by)
  select made.id, c, p, auth.uid() from (select auth.uid() union select unnest(coalesce(people,'{}'))) x(p);
 insert into public.channel_agents(channel_id, company_id, agent_id, added_by)
  select made.id, c, a, auth.uid() from (select distinct unnest(coalesce(agents,'{}'))) x(a);
 insert into public.channel_invitees(channel_id, company_id, invitation_id, added_by)
  select made.id, c, i, auth.uid() from (select distinct unnest(coalesce(invitees,'{}'))) x(i);
 return made.id;
end $$;

-- An invitation ended by this migration never makes its holder an Administrator (ADR 0019: a link never gives it either).
create or replace function public.guard_member() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'DELETE' then raise exception 'members must be removed by updating removed_at'; end if;
 if tg_op = 'UPDATE' and (new.company_id <> old.company_id or new.person_id <> old.person_id) then raise exception 'membership identity cannot change'; end if;
 if auth.uid() is not null then
  -- A signed-in person's write (the request's role), however it reaches the row: the database's own maintenance is not
  -- a person changing a Member.
  if tg_op = 'UPDATE' and current_setting('role', true) = 'authenticated' and old.removed_at is null and not public.is_company_owner(old.company_id) then
   if old.role = 'owner' and (new.role, new.grant_publishing, new.grant_money_figures, new.grant_customer_data, new.removed_at)
      is distinct from (old.role, old.grant_publishing, old.grant_money_figures, old.grant_customer_data, old.removed_at) then
    raise exception 'ownerChangedByOwnerOnly' using errcode = '42501';
   end if;
   if old.person_id = auth.uid() and (new.role, new.grant_publishing, new.grant_money_figures, new.grant_customer_data)
      is distinct from (old.role, old.grant_publishing, old.grant_money_figures, old.grant_customer_data) then
    raise exception 'ownGrantsUnchangeable' using errcode = '42501';
   end if;
  end if;
  if new.role = 'owner' and (tg_op = 'INSERT' or old.role <> 'owner' or old.removed_at is not null) and not public.can_assign_owner(new.company_id) and not exists(select 1 from public.member_invitations where company_id=new.company_id and role='owner' and claimed_at is null and ended_at is null and lower(email)=lower((select email from auth.users where id=auth.uid()))) then raise exception 'only an owner can assign owner'; end if;
  if tg_op <> 'INSERT' and old.role = 'owner' and old.removed_at is null and (new.role <> 'owner' or new.removed_at is not null) then
   perform pg_advisory_xact_lock(hashtextextended(old.company_id::text,0));
   if (select count(*) from public.members where company_id=old.company_id and role='owner' and removed_at is null) <= 1 then raise exception 'last owner cannot be removed or demoted'; end if;
  end if;
 end if;
 return new;
end $$;
