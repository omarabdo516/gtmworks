-- #950, ADR 0019: a new Person joins a Company through an Invite link an Administrator makes. The link keeps its secret
-- after `#` in the address, as the first-Owner link does (#383), so only its hash is stored, in a table only server code
-- reads. It carries the Company, who made it, when it ends (7 days), when it was used or cancelled, and, for an invite,
-- the label, the Role and the Agents the Person will see. It carries no Grant and no Channel (#926, #921). Opening the
-- page uses nothing; only sending its form claims it, in one transaction that finds it unused, not cancelled and not
-- ended, and marks it used. Password links (#954) share the table as a second kind.
-- Additive: two tables, one sequence, three functions and a wider log source list. The previous app version runs
-- against it unchanged.
create table public.company_links (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 kind text not null check (kind in ('invite')),
 secret_hash text not null unique check (secret_hash ~ '^[a-f0-9]{64}$'),
 made_by uuid references public.people(id) on delete set null,
 label text check (label is null or length(btrim(label)) between 1 and 120),
 -- An Invite link never gives the Administrator role (ADR 0019): an Administrator makes an existing Member one. The Role
 -- is text, so no table depends on the member_role type (tests/remove-agency-migration.mjs rebuilds it).
 role text check (role in ('manager','contributor','viewer')),
 created_at timestamptz not null default now(),
 ends_at timestamptz not null,
 used_at timestamptz,
 used_by uuid references public.people(id) on delete set null,
 cancelled_at timestamptz,
 check (kind<>'invite' or (label is not null and role is not null)),
 check (ends_at>created_at),
 check (used_by is null or used_at is not null),
 check (used_at is null or cancelled_at is null)
);
create index company_links_company on public.company_links(company_id,created_at desc);
alter table public.company_links enable row level security;
-- No policy and no grant to anon or authenticated: a Member's query reads no link, its own Company's included. A copy
-- of this table opens no link, as the secret is never a column.
revoke all on public.company_links from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.company_links to service_role;

-- The Agents an invited Person will see beside the main Agent, moved to the Member's own rows when the link is used.
create table public.company_link_agents (
 company_id uuid not null references public.companies(id) on delete cascade,
 link_id uuid not null references public.company_links(id) on delete cascade,
 agent_id uuid not null references public.hermes_agents(id) on delete cascade,
 primary key (link_id,agent_id)
);
alter table public.company_link_agents enable row level security;
revoke all on public.company_link_agents from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.company_link_agents to service_role;

-- "made an invite link" and "joined with an invite link" in the Company log. A link has no bigint id of its own, so its
-- log rows take theirs from a sequence.
create sequence public.company_link_log_seq;
revoke all on sequence public.company_link_log_seq from public,anon,authenticated,service_role;
alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit','note_runs','reply_cards','member_invitations','reply_card_answers','channel_permissions','agent_handovers','channel_handover_replies','channel_cards','channel_replies','conversation_archives','channel_archives','engine_dashboard','company_links'));

-- The Administrator's Invite link. The server makes the secret and sends only its hash with the Administrator's own
-- session, so this function checks who asks: an Administrator of this Company and no one else. Every Agent chosen must
-- be one of this Company's, and not its main Agent, which everyone sees. Returns the link's id.
create function public.make_invite_link(c uuid, label text, link_role text, agents uuid[], link_hash text) returns uuid
language plpgsql security definer set search_path='' as $function$
declare made uuid; named text:=btrim(coalesce(label,''),E' \t\r\n'); chosen uuid; agent public.hermes_agents;
begin
 if c is null or not public.is_company_owner(c) then raise exception 'inviteLinkNotAllowed' using errcode='42501'; end if;
 if link_role is null or link_role not in ('manager','contributor','viewer') then raise exception 'inviteRoleNotAllowed' using errcode='22023'; end if;
 if length(named) not between 1 and 120 then raise exception 'inviteLinkLabel' using errcode='22023'; end if;
 if link_hash is null or link_hash !~ '^[a-f0-9]{64}$' then raise exception 'inviteLinkInvalid' using errcode='22023'; end if;
 foreach chosen in array coalesce(agents,'{}'::uuid[]) loop
  select * into agent from public.hermes_agents a where a.id=chosen and a.company_id=c;
  if not found then raise exception 'agentNotFound' using errcode='P0002'; end if;
  if agent.is_default then raise exception 'mainAgentShownToAll' using errcode='42501'; end if;
 end loop;
 insert into public.company_links(company_id,kind,secret_hash,made_by,label,role,ends_at)
  values(c,'invite',link_hash,auth.uid(),named,link_role,now()+interval '7 days') returning id into made;
 insert into public.company_link_agents(company_id,link_id,agent_id) select c,made,x from unnest(coalesce(agents,'{}'::uuid[])) x on conflict do nothing;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),'member','invite_link_made',
   jsonb_build_object('label',named,'role',link_role,'private','managers'),'company_links',nextval('public.company_link_log_seq'),now());
 return made;
end $function$;
revoke all on function public.make_invite_link(uuid,text,text,uuid[],text) from public,anon,service_role;
grant execute on function public.make_invite_link(uuid,text,text,uuid[],text) to authenticated;

-- Whether an Invite link can still be used, with the Company and the Role it names, for the page to show before its
-- form. It reads and writes nothing else, so opening the page (or a link preview fetching it) never uses the link up.
create function public.invite_link_open(link_hash text) returns table(company text, role text)
language sql stable security definer set search_path='' as $function$
 select c.name,l.role from public.company_links l join public.companies c on c.id=l.company_id
 where l.secret_hash=link_hash and l.kind='invite' and l.used_at is null and l.cancelled_at is null and l.ends_at>now();
$function$;
revoke all on function public.invite_link_open(text) from public,anon,authenticated,service_role;
grant execute on function public.invite_link_open(text) to service_role;

-- Sending an Invite link's form spends it: the link's row is locked first, so of two sends at the same moment the second
-- waits and then finds it used. A new Person's row is written (the server's own key made their account), they become a
-- Member with the link's Role and no Grant, they see the link's Agents beside the main one, and the link is marked used
-- by them. A Person already an active Member is refused and nothing changes (#775). Returns the Company's slug.
create function public.claim_invite_link(link_hash text, person uuid, person_name text, language text) returns text
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
revoke all on function public.claim_invite_link(text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_invite_link(text,uuid,text,text) to service_role;
