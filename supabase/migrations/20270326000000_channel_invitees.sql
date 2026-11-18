-- #207 An invited person is in the general channel from the moment of the invite, before they join. The channel's
-- members list them with the name made from their email, their Role and "Invite sent"; every count of members includes
-- them, and the channel gets one quiet line naming the invite. The Owner and the Managers see an invitee's email (decision
-- 0043); everyone else sees the name, the Role and "Invite sent", and the email never reaches them.
-- Like channel_people (#24), a team channel stores the invitations it was given (channel_invitees); the general channel
-- holds every open invitation already, so nothing is stored for it. When the person joins, their rows become ordinary
-- Members of the same channels; when the invitation is withdrawn, the rows go with it.
-- Additive: two tables, one helper, one new way to make a channel with invited people, two triggers on
-- member_invitations, and channel_members and claim_invitations redefined. The previous app version runs against it
-- unchanged: channel_members still answers the person, name and role it reads, and create_channel still takes its five
-- arguments.

-- The name an invited person goes by until they join (lib/invite.mjs: inviteeName): the first word of the email's local
-- part, capitalised.
create function public.invitee_name(mail text) returns text language plpgsql immutable set search_path='' as $$
declare local_part text := split_part(coalesce(mail,''),'@',1); stripped text; word text;
begin
 stripped := regexp_replace(local_part, '^[._+0-9-]+', '');
 word := coalesce((regexp_match(stripped, '^[^._+0-9-]+'))[1], local_part);
 return upper(left(word,1)) || lower(substr(word,2));
end $$;
revoke all on function public.invitee_name(text) from public,anon,authenticated,service_role;

-- The invitations a team channel was given, as channel_people holds its people. An invitation stays in the channel until
-- the person joins (their rows become channel_people) or the invitation is withdrawn (its row goes).
create table public.channel_invitees (
 channel_id uuid not null,
 company_id uuid not null,
 kind text not null default 'team' check (kind='team'),
 invitation_id uuid not null references public.member_invitations(id) on delete cascade,
 added_by uuid references public.people(id),
 added_at timestamptz not null default now(),
 primary key (channel_id, invitation_id),
 foreign key (channel_id, company_id, kind) references public.channels(id, company_id, kind) on delete cascade
);

-- One quiet line in a channel that is not a message: no writer to mention and no Run. Keyed by its invitation, so an
-- invitation sent again adds no second line.
create table public.channel_notes (
 id bigint generated always as identity primary key,
 company_id uuid not null,
 channel_id uuid not null,
 kind text not null default 'invite' check (kind='invite'),
 invitation_id uuid unique references public.member_invitations(id) on delete set null,
 invitee_name text not null,
 actor_id uuid references public.people(id),
 actor_name text not null,
 created_at timestamptz not null default now(),
 foreign key (channel_id, company_id) references public.channels(id, company_id) on delete cascade
);
create index channel_notes_order on public.channel_notes(channel_id, created_at);

-- 20261219000000's channel_members, plus the invitations the channel holds: in the general channel every open invitation
-- of the Company, in a team channel the ones it was given. An invitation whose email is already a Member's is that
-- Member's row. The email comes back to the Owner and the Managers only.
drop function public.channel_members(uuid);
create function public.channel_members(ch uuid) returns table(person uuid, name text, role text, invitation uuid, email text)
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
   join public.member_invitations v on v.company_id=k.company_id and v.claimed_at is null
  where k.id=ch and public.in_channel(ch)
   and (k.kind='general' or exists(select 1 from public.channel_invitees i where i.channel_id=k.id and i.invitation_id=v.id))
   and not exists(select 1 from public.members m join auth.users u on u.id=m.person_id
    where m.company_id=k.company_id and m.removed_at is null and lower(u.email)=lower(v.email))
 ) rows
 order by case role when 'owner' then 0 when 'manager' then 1 when 'contributor' then 2 else 3 end, name, person nulls last, invitation;
$$;
revoke all on function public.channel_members(uuid) from public,anon,service_role;
grant execute on function public.channel_members(uuid) to authenticated;

-- The line an invitation adds to the Company's general channel (design-reference: sendInvite's note), once per
-- invitation: who invited, and the name the invited person goes by until they join.
create function public.note_member_invitation() returns trigger language plpgsql security definer set search_path='' as $$
declare general uuid;
begin
 select k.id into general from public.channels k where k.company_id=new.company_id and k.kind='general';
 if general is null then return null; end if;
 insert into public.channel_notes(company_id, channel_id, kind, invitation_id, invitee_name, actor_id, actor_name)
  values (new.company_id, general, 'invite', new.id, public.invitee_name(new.email), auth.uid(),
   coalesce((select btrim(p.name) from public.people p where p.id=auth.uid()),''))
  on conflict (invitation_id) do nothing;
 return null;
end $$;
revoke all on function public.note_member_invitation() from public,anon,authenticated,service_role;
create trigger member_invitations_note_insert after insert on public.member_invitations
 for each row when (new.claimed_at is null) execute function public.note_member_invitation();
create trigger member_invitations_note_reopen after update of claimed_at on public.member_invitations
 for each row when (old.claimed_at is not null and new.claimed_at is null) execute function public.note_member_invitation();

-- One invitation in or out of a team channel, by an Owner or a Manager who is in it, as set_channel_person (#24) does
-- with a Member. The invitation must be open and of this Company; the general channel's invitees are never chosen.
-- Refusals: P0002 channelNotFound, memberNotFound; 42501 channelNotAllowed; 22023 channelFailed.
create function public.set_channel_invitee(ch uuid, invitation uuid, present boolean) returns void
language plpgsql security definer set search_path='' as $$
declare k public.channels;
begin
 select * into k from public.channels where id=ch;
 if k.id is null or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.can_manage_company(k.company_id) or k.kind<>'team' then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if present is null or invitation is null then raise exception 'channelFailed' using errcode='22023'; end if;
 if not present then delete from public.channel_invitees where channel_id=ch and invitation_id=invitation; return; end if;
 if not exists(select 1 from public.member_invitations v where v.id=invitation and v.company_id=k.company_id and v.claimed_at is null) then
  raise exception 'memberNotFound' using errcode='P0002'; end if;
 insert into public.channel_invitees(channel_id, company_id, invitation_id, added_by) values (ch, k.company_id, invitation, auth.uid())
  on conflict (channel_id, invitation_id) do nothing;
end $$;

-- 20261227000000's create_channel, and the invitations chosen with its people: each must be open in this Company. The
-- channel the previous version makes is the same function with no invited people, so its five arguments still work.
create function public.create_channel_inviting(c uuid, request_key uuid, channel_name text, people uuid[], agents uuid[], invitees uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare made public.channels; called text;
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
 if exists(select 1 from unnest(coalesce(invitees,'{}')) i where not exists(select 1 from public.member_invitations v
  where v.id=i and v.company_id=c and v.claimed_at is null)) then
  raise exception 'memberNotFound' using errcode='P0002'; end if;
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

-- 20270108000000's claim_invitations, and the invitations' channels become the joining person's own: they are a Member
-- of each channel the invitation was given to, reading it from the message they joined after.
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
  insert into public.channel_people(channel_id, company_id, person_id, joined_through, added_by)
   select i.channel_id, i.company_id, auth.uid(), coalesce((select max(m.id) from public.channel_messages m where m.channel_id=i.channel_id),0), i.added_by
   from public.channel_invitees i where i.invitation_id=inv.id
   on conflict (channel_id, person_id) do nothing;
  delete from public.channel_invitees where invitation_id=inv.id;
  delete from public.invitation_agent_access where invitation_id=inv.id;
  update public.member_invitations set claimed_at=now() where id=inv.id;
 end loop;
end $$;

-- #24's channel, with no invited people: what the previous app version calls.
create or replace function public.create_channel(c uuid, request_key uuid, channel_name text, people uuid[], agents uuid[]) returns uuid
language sql security definer set search_path='' as $$
 select public.create_channel_inviting(c, request_key, channel_name, people, agents, null);
$$;

revoke all on function public.set_channel_invitee(uuid,uuid,boolean), public.create_channel_inviting(uuid,uuid,text,uuid[],uuid[],uuid[]) from public,anon,service_role;
grant execute on function public.set_channel_invitee(uuid,uuid,boolean), public.create_channel_inviting(uuid,uuid,text,uuid[],uuid[],uuid[]) to authenticated;

alter table public.channel_invitees enable row level security;
alter table public.channel_notes enable row level security;
create policy channel_invitees_read on public.channel_invitees for select to authenticated using (public.in_channel(channel_id));
create policy channel_notes_read on public.channel_notes for select to authenticated using (public.in_channel(channel_id));
revoke all on public.channel_invitees, public.channel_notes from anon, authenticated, service_role;
grant select on public.channel_invitees to authenticated;
-- A note's line is its name and who invited; its invitation stays out.
grant select (id, company_id, channel_id, kind, invitee_name, actor_id, actor_name, created_at) on public.channel_notes to authenticated;
