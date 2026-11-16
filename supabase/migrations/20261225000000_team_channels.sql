-- #24 Team channels, unread counts and channel-scoped Agents. An Owner or a Manager makes a team channel with a name,
-- the Members in it and the Agents in it, and changes both lists later. Each fact has one owner: who is in the general
-- channel stays derived (#23) and its Agents are the ones each person already sees (#15); a team channel stores its
-- people (channel_people) and its Agents (channel_agents). Inside a team channel its members see and call its Agents,
-- even one hidden from them elsewhere; agent_visible_to and can_see_agent do not change, so a direct Conversation with
-- such an Agent stays impossible. A person's unread count is derived when it is read, from their read position
-- (channel_reads) and the message they joined after. A Member outside a team channel, the Owner included, does not
-- see that it exists.
-- Additive: three new tables, three new columns on channels, a trigger on members. The previous app version runs against
-- it unchanged: it reads channels and posts as before, and only this version makes a team channel.

alter table public.channels drop constraint channels_kind_check;
alter table public.channels
 alter column kind drop default,
 add constraint channels_kind_check check (kind in ('general','team')),
 add column name text,
 add column created_by uuid references public.people(id),
 add column create_key uuid,
 add constraint channels_team_named check ((kind='team') = (name is not null)),
 add constraint channels_team_made check (kind='general' or (created_by is not null and create_key is not null)),
 add constraint channels_name_shape check (name is null or (length(name) between 1 and 32 and name !~ '^[[:space:]#]|[[:space:]]$')),
 add constraint channels_create_key unique (company_id, create_key),
 add constraint channels_id_company_kind unique (id, company_id, kind);
create unique index channels_team_name on public.channels(company_id, lower(name)) where kind='team';

-- The people of a team channel. joined_through is the newest message when they were added: what came before is not
-- unread for them.
create table public.channel_people (
 channel_id uuid not null,
 company_id uuid not null,
 kind text not null default 'team' check (kind='team'),
 person_id uuid not null,
 joined_through bigint not null default 0 check (joined_through >= 0),
 added_by uuid references public.people(id),
 added_at timestamptz not null default now(),
 primary key (channel_id, person_id),
 foreign key (channel_id, company_id, kind) references public.channels(id, company_id, kind) on delete cascade,
 foreign key (company_id, person_id) references public.members(company_id, person_id) on delete cascade
);

-- The Agents a team channel's members call there.
create table public.channel_agents (
 channel_id uuid not null,
 company_id uuid not null,
 kind text not null default 'team' check (kind='team'),
 agent_id uuid not null,
 added_by uuid references public.people(id),
 added_at timestamptz not null default now(),
 primary key (channel_id, agent_id),
 foreign key (channel_id, company_id, kind) references public.channels(id, company_id, kind) on delete cascade,
 foreign key (company_id, agent_id) references public.hermes_agents(company_id, id) on delete cascade
);

-- How far each person has read a channel, moved only forward and only by that person opening it (read_channel).
create table public.channel_reads (
 channel_id uuid not null,
 company_id uuid not null,
 person_id uuid not null,
 read_through bigint not null default 0 check (read_through >= 0),
 read_at timestamptz not null default now(),
 primary key (channel_id, person_id),
 foreign key (channel_id, company_id) references public.channels(id, company_id) on delete cascade,
 foreign key (company_id, person_id) references public.members(company_id, person_id) on delete cascade
);

-- Who can be in a channel: an active Member who is a person, never a legacy role Agent (#23's rule, now in one place).
create function public.channel_person(c uuid, person uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.removed_at is null
  and m.agent_role is null and not exists(select 1 from public.agents a where a.id=m.person_id));
$$;
revoke all on function public.channel_person(uuid,uuid) from public,anon,authenticated,service_role;

-- 20261219000000's membership: the general channel holds every person-Member of a Company that does not work alone; a
-- team channel holds the person-Members it names.
create or replace function public.channel_member(ch uuid, person uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.channels k join public.companies co on co.id=k.company_id
  where k.id=ch and co.work_mode is distinct from 'alone' and public.channel_person(k.company_id, person)
   and (k.kind='general' or exists(select 1 from public.channel_people p where p.channel_id=k.id and p.person_id=person)));
$$;

-- The Agents a person sees and calls inside one channel: in the general channel the ones they see anywhere (#15), in a
-- team channel the channel's own.
create function public.channel_agent(ch uuid, person uuid, agent uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.channels k join public.hermes_agents h on h.company_id=k.company_id and h.id=agent
  where k.id=ch and public.channel_member(ch, person)
   and case when k.kind='general' then public.agent_visible_to(k.company_id, person, agent)
    else exists(select 1 from public.channel_agents a where a.channel_id=ch and a.agent_id=agent) end);
$$;
revoke all on function public.channel_agent(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- The Agent a message calls, by channel_mention's rules (20261224000000: the earliest call wins, then the longer name,
-- then the main Agent), among the Agents callable in this channel.
create function public.channel_mention_in(ch uuid, person uuid, message text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare a record; best uuid; best_at int; best_len int; found_at int;
begin
 for a in select h.id, btrim(h.name) agent_name from public.channels k join public.hermes_agents h on h.company_id=k.company_id
   where k.id=ch and btrim(h.name)<>'' and public.channel_agent(ch, person, h.id) order by h.is_default desc, h.id loop
  found_at := public.mention_at(message, a.agent_name);
  if found_at > 0 and (best is null or found_at < best_at or (found_at = best_at and length(lower(a.agent_name)) > best_len)) then
   best := a.id; best_at := found_at; best_len := length(lower(a.agent_name));
  end if;
 end loop;
 return best;
end $$;
revoke all on function public.channel_mention_in(uuid,uuid,text) from public,anon,authenticated,service_role;

-- 20261219000000's post_channel_message; the Agent called is now one callable in this channel.
create or replace function public.post_channel_message(ch uuid, message_key uuid, message text) returns bigint
language plpgsql security definer set search_path='' as $$
declare k public.channels; saved bigint; writer text; chosen public.hermes_agents;
begin
 select * into k from public.channels where id=ch;
 if k.id is null or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.conversation_can_write(k.company_id) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if message_key is null or message is null or btrim(message)='' or length(message) > 20000 then raise exception 'channelFailed' using errcode='22023'; end if;
 select coalesce(btrim(name),'') into writer from public.people where id=auth.uid();
 insert into public.channel_messages(company_id, channel_id, author, person_id, author_name, body, send_key)
  values (k.company_id, ch, 'person', auth.uid(), coalesce(writer,''), message, message_key)
  on conflict (channel_id, send_key) do nothing returning id into saved;
 if saved is null then
  select id into saved from public.channel_messages where channel_id=ch and send_key=message_key and person_id=auth.uid();
  if saved is null then raise exception 'channelFailed' using errcode='22023'; end if;
  return saved;
 end if;
 select * into chosen from public.hermes_agents where id=public.channel_mention_in(ch, auth.uid(), message);
 if chosen.id is not null then
  insert into public.channel_runs(message_id, company_id, channel_id, agent_id, agent_name, session, input, instructions, rules)
   values (saved, k.company_id, ch, chosen.id, chosen.name, md5(ch::text||':'||chosen.id::text)::uuid,
           split_part(coalesce(writer,''),' ',1)||': '||message, nullif(btrim(chosen.instructions),''), public.agent_rules_in_force(chosen.id));
 end if;
 return saved;
end $$;
revoke all on function public.post_channel_message(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.post_channel_message(uuid,uuid,text) to authenticated;

-- The caller's Agents in one channel, each marked when it is shown to them in this channel only.
create function public.channel_agent_list(ch uuid) returns table(id uuid, connection_id uuid, name text, speciality text, main boolean, here_only boolean)
language sql stable security definer set search_path='' as $$
 select h.id, h.connection_id, h.name, h.speciality, h.is_default, not public.agent_visible_to(h.company_id, auth.uid(), h.id)
 from public.channels k join public.hermes_agents h on h.company_id=k.company_id
 where k.id=ch and auth.uid() is not null and public.channel_agent(ch, auth.uid(), h.id)
 order by h.is_default desc, h.name, h.id;
$$;

-- The caller's channels in one Company, the general one first, each with how many messages are new to them: written
-- after both their read position and the point they joined, by anyone but them (an Agent's reply counts).
create function public.channel_sidebar(c uuid) returns table(id uuid, kind text, name text, unread integer)
language sql stable security definer set search_path='' as $$
 select k.id, k.kind, k.name, (select count(*)::int from public.channel_messages m where m.channel_id=k.id
   and m.person_id is distinct from auth.uid()
   and m.id > greatest(coalesce((select r.read_through from public.channel_reads r where r.channel_id=k.id and r.person_id=auth.uid()),0),
                       coalesce((select p.joined_through from public.channel_people p where p.channel_id=k.id and p.person_id=auth.uid()),0)))
 from public.channels k
 where k.company_id=c and auth.uid() is not null and public.in_channel(k.id)
 order by k.kind='general' desc, k.created_at, k.id;
$$;

-- The caller has read the channel through the message `through` (never past its newest, never backwards).
create function public.read_channel(ch uuid, through bigint) returns void
language plpgsql security definer set search_path='' as $$
declare k public.channels; newest bigint;
begin
 select * into k from public.channels where id=ch;
 if k.id is null or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 select coalesce(max(id),0) into newest from public.channel_messages where channel_id=ch;
 insert into public.channel_reads(channel_id, company_id, person_id, read_through)
  values (ch, k.company_id, auth.uid(), greatest(least(coalesce(through,0), newest), 0))
  on conflict (channel_id, person_id) do update set read_through=excluded.read_through, read_at=now()
   where public.channel_reads.read_through < excluded.read_through;
end $$;

-- A team channel, made by an Owner or a Manager of a Company that works as a team. Its name is the one typed without
-- leading '#' or spaces, unique in the Company ignoring case, and never the general channel's. Its creator is always
-- in it; every other person is an active person-Member, and every Agent one the creator sees. The same request key
-- from the same creator returns the channel it made. Refusals: 42501 channelNotAllowed; 22023 channelFailed (no key,
-- or another person's), channelNameMissing, channelNameTooLong; 23505 channelNameTaken; P0002 memberNotFound,
-- agentNotFound.
create function public.create_channel(c uuid, request_key uuid, channel_name text, people uuid[], agents uuid[]) returns uuid
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
 return made.id;
end $$;

-- One person in or out of a team channel, by an Owner or a Manager who is in it. Nobody takes themselves out, and the
-- general channel's people are never chosen. Repeating a change changes nothing. Refusals: P0002 channelNotFound (not
-- in it, unknown), memberNotFound; 42501 channelNotAllowed; 22023 channelFailed.
create function public.set_channel_person(ch uuid, person uuid, present boolean) returns void
language plpgsql security definer set search_path='' as $$
declare k public.channels;
begin
 select * into k from public.channels where id=ch;
 if k.id is null or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.can_manage_company(k.company_id) or k.kind<>'team' or person=auth.uid() then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if present is null or person is null then raise exception 'channelFailed' using errcode='22023'; end if;
 if not present then delete from public.channel_people where channel_id=ch and person_id=person; return; end if;
 if not public.channel_person(k.company_id, person) then raise exception 'memberNotFound' using errcode='P0002'; end if;
 insert into public.channel_people(channel_id, company_id, person_id, joined_through, added_by)
  values (ch, k.company_id, person, coalesce((select max(id) from public.channel_messages where channel_id=ch),0), auth.uid())
  on conflict (channel_id, person_id) do nothing;
end $$;

-- One Agent in or out of a team channel, by an Owner or a Manager who is in it. An Agent added is one the caller sees;
-- any Agent of the channel can be taken out. Refusals as set_channel_person, and P0002 agentNotFound.
create function public.set_channel_agent(ch uuid, agent uuid, present boolean) returns void
language plpgsql security definer set search_path='' as $$
declare k public.channels;
begin
 select * into k from public.channels where id=ch;
 if k.id is null or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.can_manage_company(k.company_id) or k.kind<>'team' then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if present is null or agent is null then raise exception 'channelFailed' using errcode='22023'; end if;
 if not present then delete from public.channel_agents where channel_id=ch and agent_id=agent; return; end if;
 if not exists(select 1 from public.hermes_agents h where h.company_id=k.company_id and h.id=agent) or not public.agent_visible_to(k.company_id, auth.uid(), agent) then
  raise exception 'agentNotFound' using errcode='P0002'; end if;
 insert into public.channel_agents(channel_id, company_id, agent_id, added_by) values (ch, k.company_id, agent, auth.uid())
  on conflict (channel_id, agent_id) do nothing;
end $$;

revoke all on function public.channel_agent_list(uuid), public.channel_sidebar(uuid), public.read_channel(uuid,bigint),
 public.create_channel(uuid,uuid,text,uuid[],uuid[]), public.set_channel_person(uuid,uuid,boolean), public.set_channel_agent(uuid,uuid,boolean)
 from public,anon,service_role;
grant execute on function public.channel_agent_list(uuid), public.channel_sidebar(uuid), public.read_channel(uuid,bigint),
 public.create_channel(uuid,uuid,text,uuid[],uuid[]), public.set_channel_person(uuid,uuid,boolean), public.set_channel_agent(uuid,uuid,boolean)
 to authenticated;

-- A Member who joins a Company later has read its general channel up to that moment, as a person added to a team channel
-- has; the general channel's people are derived, so its starting point is the read position itself.
create function public.start_general_read() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.channel_reads(channel_id, company_id, person_id, read_through)
  select k.id, k.company_id, new.person_id, coalesce((select max(m.id) from public.channel_messages m where m.channel_id=k.id),0)
  from public.channels k where k.company_id=new.company_id and k.kind='general'
  on conflict (channel_id, person_id) do nothing;
 return null;
end $$;
revoke all on function public.start_general_read() from public,anon,authenticated,service_role;
create trigger members_general_read after insert on public.members for each row execute function public.start_general_read();

-- Members today have read their general channel up to now: the counts start at zero.
insert into public.channel_reads(channel_id, company_id, person_id, read_through)
 select k.id, k.company_id, m.person_id, coalesce((select max(x.id) from public.channel_messages x where x.channel_id=k.id),0)
 from public.channels k join public.members m on m.company_id=k.company_id where k.kind='general'
 on conflict (channel_id, person_id) do nothing;

alter table public.channel_people enable row level security;
alter table public.channel_agents enable row level security;
alter table public.channel_reads enable row level security;
create policy channel_people_read on public.channel_people for select to authenticated using (public.in_channel(channel_id));
create policy channel_agents_read on public.channel_agents for select to authenticated using (public.in_channel(channel_id));
create policy channel_reads_read on public.channel_reads for select to authenticated using (person_id=auth.uid() and public.in_channel(channel_id));
revoke all on public.channel_people, public.channel_agents, public.channel_reads from anon, authenticated, service_role;
grant select on public.channel_people, public.channel_agents, public.channel_reads to authenticated;
