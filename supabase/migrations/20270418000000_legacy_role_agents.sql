-- #703, spec #695, ADR 0023: the first step of removing the four legacy role agents (Account manager, Writer, Designer,
-- Critic). Nothing is taken away here: the previous release's Members page, its Agents page and its board still read and
-- write members.agent_role, public.agents and public.agent_grants until the cutover
-- (20270418000001_legacy_role_agents_cutover.sql) removes them once this release serves.
--
-- 1. The install's own rows are settled. The old name match (20261110000000) made an identity a role agent by its name, so
--    a person could hold a role key by mistake. Whether the identity ever signed in tells the two apart:
--    - one that signed in is a person: every membership is kept and the key goes, so it is mentioned and in channels again;
--    - one that never signed in is an old agent: its memberships are marked removed and it can no longer sign in. Its
--      people row stays, so what it wrote keeps its name.
--    An identity recorded as a shared role agent (public.agents) that also signed in cannot be told: the update stops with
--    its name and changes nothing. The cutover settles again, for anything the previous release wrote between the steps.
-- 2. Every function that asked whether a member is a role agent loses that branch: mentions, channels, a Conversation's
--    addressee and the log's actor kind. Old log rows keep the actor kind and the name they were stored with.

create function public.settle_legacy_role_agents() returns void language plpgsql set search_path = '' as $$
declare unsure text; old_agents uuid[];
begin
 select string_agg(distinct coalesce(nullif(btrim(p.name),''), a.id::text), ', ') into unsure
  from public.agents a join auth.users u on u.id=a.id left join public.people p on p.id=a.id
  where u.last_sign_in_at is not null;
 if unsure is not null then
  raise exception 'The update stopped: % signed in as a person but is recorded as a legacy role agent, so it cannot be told which one it is. Nothing was changed.', unsure
   using errcode='P0001', hint='Tell the maintainers whether this identity is a person or one of the old role agents (spec #695).';
 end if;
 -- A person who holds a role key keeps every membership and loses the key.
 update public.members m set agent_role=null
  from auth.users u where u.id=m.person_id and m.agent_role is not null and u.last_sign_in_at is not null;
 -- What is left never signed in: the shared role agents and every member still holding a key.
 select coalesce(array_agg(id),'{}') into old_agents from (select a.id from public.agents a
  union select m.person_id from public.members m where m.agent_role is not null) x;
 update public.members m set removed_at=now() where m.removed_at is null and m.person_id=any(old_agents);
 update auth.users u set banned_until='infinity' where u.id=any(old_agents) and u.banned_until is distinct from 'infinity';
end $$;
revoke all on function public.settle_legacy_role_agents() from public, anon, authenticated, service_role;

select public.settle_legacy_role_agents();

-- The log's actor kind: a person, or the system. A Company Agent's own rows name their kind where they are written.
create or replace function public.log_actor_kind(c uuid, actor uuid) returns text language sql stable security definer set search_path = '' as $$
 select case when actor is null then 'system' else 'person' end;
$$;

-- A membership change's details; an old row keeps the role key it was stored with, and a new one has none.
create or replace function public.log_member_details(person_name text, before_data jsonb, after_data jsonb) returns jsonb language sql immutable set search_path = '' as $$
 select jsonb_strip_nulls(jsonb_build_object(
  'person_name',person_name,
  'old_role',before_data->>'role',
  'new_role',after_data->>'role',
  'changed',case when before_data is not null and after_data is not null then
   (select coalesce(jsonb_agg(k order by k),'[]'::jsonb) from jsonb_object_keys(after_data) k where before_data->k is distinct from after_data->k) end));
$$;

create or replace function public.conversation_addressee(c uuid, message text) returns table(person uuid, name text) language sql stable security definer set search_path = '' as $$
 select p.id,p.name from public.members m join public.people p on p.id=m.person_id, lateral (select ltrim(message) as text) t
 where m.company_id=c and m.removed_at is null and length(btrim(p.name))>0
  and not exists(select 1 from public.hermes_agents h where h.company_id=c and lower(h.name)=lower(p.name))
  and lower(left(t.text,length(p.name)+1))='@'||lower(p.name)
  and (length(t.text)=length(p.name)+1 or substr(t.text,length(p.name)+2,1) ~ '[[:space:][:punct:]،؛؟]')
 order by length(p.name) desc,p.id limit 1;
$$;

create or replace function public.note_mentions() returns trigger language plpgsql security definer set search_path = '' as $$
declare writer text; card_title text; chosen public.hermes_agents;
begin
 if public.log_actor_kind(new.company_id, new.author_id) <> 'person' then return null; end if;
 if exists(select 1 from public.work_cards w where w.company_id=new.company_id and w.id=new.card_id and w.archived_at is not null) then return null; end if;
 select coalesce(btrim(name),'') into writer from public.people where id=new.author_id;
 select btrim(title) into card_title from public.work_cards where company_id=new.company_id and id=new.card_id;
 insert into public.waiting_items(company_id, person_id, kind, title, body, asked_by, card_id, note_id)
  select new.company_id, m.person_id, 'mention', left(coalesce(nullif(card_title,''), '#'||new.card_id), 300), left(new.body, 4000),
   left(coalesce(writer,''), 120), new.card_id, new.id
  from public.members m join public.people p on p.id=m.person_id
  where m.company_id=new.company_id and m.removed_at is null and m.person_id <> new.author_id and btrim(p.name) <> ''
   and (public.mention_at(new.body, p.name) > 0 or public.mention_at(new.body, split_part(btrim(p.name),' ',1)) > 0)
  on conflict (note_id, person_id) where note_id is not null do nothing;
 select * into chosen from public.hermes_agents where id=public.channel_mention(new.company_id, new.author_id, new.body);
 if chosen.id is not null then
  insert into public.note_runs(note_id, company_id, card_id, agent_id, agent_name, session, input, instructions, rules)
   values (new.id, new.company_id, new.card_id, chosen.id, chosen.name, md5('note:'||new.card_id||':'||chosen.id::text)::uuid,
           split_part(coalesce(writer,''),' ',1)||': '||new.body, nullif(btrim(chosen.instructions),''), public.agent_rules_in_force(chosen.id))
   on conflict (note_id) do nothing;
 end if;
 return null;
end $$;

create or replace function public.channel_person(c uuid, person uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.removed_at is null);
$$;

create or replace function public.channel_message_mentions(ch uuid, person uuid, message text) returns table(person uuid) language sql stable security definer set search_path = '' as $$
 select m.person_id from public.channels k
  join public.members m on m.company_id=k.company_id
  join public.people p on p.id=m.person_id
 where k.id=ch and m.removed_at is null
  and public.channel_member(ch, m.person_id) and m.person_id <> person
  and btrim(p.name) <> ''
  and not exists(select 1 from public.hermes_agents h where h.company_id=k.company_id
   and lower(btrim(h.name)) in (lower(btrim(p.name)), lower(split_part(btrim(p.name),' ',1))))
  and (public.mention_at(message, p.name) > 0 or public.mention_at(message, split_part(btrim(p.name),' ',1)) > 0)
 order by m.person_id;
$$;

-- A new Card's request (New card on the board) was addressed to a role agent, which since #341 nothing runs. It is addressed
-- to one of the Company's own Agents the reader sees, as an idea from the Ideas column is (create_work_card), and the
-- message is its first comment. The previous release's request to a role agent finds none and is refused, as it was for
-- an agent without an active grant.
create or replace function public.create_card_request(c uuid, message text, agent uuid, card_mode text) returns bigint language plpgsql set search_path = '' as $$
declare result bigint; first_stage bigint; text_body text := btrim(coalesce(message,'')); begin
 if not public.work_can_edit(c) then raise exception 'not permitted'; end if;
 if text_body='' or card_mode is null or card_mode not in ('plan','do','answer') then raise exception 'invalid request' using errcode='22023'; end if;
 if agent is null or not exists(select 1 from public.hermes_agents h where h.company_id=c and h.id=agent)
  or not public.can_see_agent(c,agent) then raise exception 'agent not found'; end if;
 select id into first_stage from public.work_stages where company_id=c and kind='ideas';
 if first_stage is null then raise exception 'no Ideas stage'; end if;
 insert into public.work_cards(company_id,stage_id,title,mode,agent_id) values (c,first_stage,left(btrim(split_part(text_body,E'\n',1)),80),card_mode,agent) returning id into result;
 insert into public.work_comments(company_id,card_id,body) values (c,result,text_body);
 return result;
end $$;
