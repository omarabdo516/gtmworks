-- #200 A channel message that names a Member waits for them: "@" and an active Member's full or first name (#22's rule
-- for a note) puts one "Waiting on you" item before that Member, under "Mentions of you", pointing at the message. Only a
-- Member of that channel can be mentioned — a Viewer included, who reads and sees their own mentions — never its writer,
-- never a Member outside it, and never a name one of the Company's Agents carries (ADR 0015). A message that names two
-- Members makes one item for each; sending it again under the same key makes none. A mention starts no Run and writes no
-- log row: the message is the record. The item leaves the list when its Member opens it from the list
-- (read_channel_mention), never by opening the channel another way.
-- Additive: one column on waiting_items with its index and its line in the read policy, one helper, read_channel_mention,
-- and post_channel_message redefined from its latest definition (20270325000000's). The previous app version runs against
-- it unchanged: it posts the same messages and starts the same Runs, and the rows this version adds are ones it never
-- writes and no read of its returns differently.

-- The message a waiting item points at, for a mention in a channel (the note a #22 mention opens is note_id). Such an
-- item has no Card and no Conversation, so the row's source check names the message too.
alter table public.waiting_items add column channel_message_id bigint references public.channel_messages(id);
alter table public.waiting_items drop constraint waiting_items_source;
alter table public.waiting_items add constraint waiting_items_source check (card_id is not null or conversation_id is not null
 or agent_rule_id is not null or channel_message_id is not null);
-- One item per message and Member: a message that names the same Member twice is one mention.
create unique index waiting_items_one_per_channel_message on public.waiting_items(channel_message_id, person_id) where channel_message_id is not null;

-- Each person reads only what is addressed to them, in a Company they are still in, as before (#15, #25), and a channel
-- mention only while they are still in its channel: taken out of the channel or of the Company, it is gone from their list
-- (ADR 0004). The rest of the rule is 20261220000000's, unchanged.
alter policy waiting_items_read on public.waiting_items using (person_id=auth.uid() and public.is_member(company_id)
 and public.can_see_conversation_agent(company_id,conversation_id) and public.can_decide_waiting_rule(company_id,agent_rule_id)
 and (channel_message_id is null or exists(select 1 from public.channel_messages m where m.id=waiting_items.channel_message_id and public.in_channel(m.channel_id))));

-- The Members a channel message names, as #22 names one in a note: "@" and an active Member's full or first name, bounded
-- by the start, a space or a punctuation mark on each side. Only a person-Member of that channel (general or team, never an
-- invitee who has no person), never the writer, and never a name an Agent of the Company carries: that name calls the
-- Agent (ADR 0015). One row per Member, whatever the message says twice.
create function public.channel_message_mentions(ch uuid, person uuid, message text) returns table(person uuid)
language sql stable security definer set search_path='' as $$
 select m.person_id from public.channels k
  join public.members m on m.company_id=k.company_id
  join public.people p on p.id=m.person_id
 where k.id=ch and m.removed_at is null and m.agent_role is null
  and not exists(select 1 from public.agents a where a.id=m.person_id)
  and public.channel_member(ch, m.person_id) and m.person_id <> person
  and btrim(p.name) <> ''
  and not exists(select 1 from public.hermes_agents h where h.company_id=k.company_id
   and lower(btrim(h.name)) in (lower(btrim(p.name)), lower(split_part(btrim(p.name),' ',1))))
  and (public.mention_at(message, p.name) > 0 or public.mention_at(message, split_part(btrim(p.name),' ',1)) > 0)
 order by m.person_id;
$$;
revoke all on function public.channel_message_mentions(uuid,uuid,text) from public,anon,authenticated,service_role;

-- 20270325000000's post_channel_message, and the Members the message names: one waiting item before each, in the same
-- transaction as the message, so a message that was not saved mentions nobody. The title holds the channel's name, or
-- "general" for a channel that has none (a reader draws the general channel's own word).
create or replace function public.post_channel_message(ch uuid, message_key uuid, message text) returns bigint
language plpgsql security definer set search_path='' as $$
declare k public.channels; saved bigint; writer text; chosen record;
begin
 select * into k from public.channels where id=ch;
 if k.id is null or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if not public.conversation_can_write(k.company_id) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if message_key is null or message is null or (btrim(message)='' and not exists(select 1 from public.channel_attachments a left join public.channel_messages m on m.id=a.message_id where a.channel_id=ch and a.send_key=message_key and a.person_id=auth.uid() and (a.message_id is null or (m.channel_id=ch and m.send_key=message_key and m.person_id=auth.uid() and m.author='person')))) or length(message) > 20000 then raise exception 'channelFailed' using errcode='22023'; end if;
 select coalesce(btrim(name),'') into writer from public.people where id=auth.uid();
 insert into public.channel_messages(company_id, channel_id, author, person_id, author_name, body, send_key)
  values (k.company_id, ch, 'person', auth.uid(), coalesce(writer,''), message, message_key)
  on conflict (channel_id, send_key) do nothing returning id into saved;
 if saved is null then
  select id into saved from public.channel_messages where channel_id=ch and send_key=message_key and person_id=auth.uid();
  if saved is null then raise exception 'channelFailed' using errcode='22023'; end if;
  return saved;
 end if;
 for chosen in select h.*, m.ordinal from public.channel_mentions_in(ch, auth.uid(), message) m
  join public.hermes_agents h on h.id=m.agent order by m.ordinal loop
  insert into public.channel_runs(message_id, ordinal, company_id, channel_id, agent_id, agent_name, session, input, instructions, rules)
   values (saved, chosen.ordinal, k.company_id, ch, chosen.id, chosen.name, md5(ch::text||':'||chosen.id::text)::uuid,
           split_part(coalesce(writer,''),' ',1)||': '||message, nullif(btrim(chosen.instructions),''), public.agent_rules_in_force(chosen.id));
 end loop;
 insert into public.waiting_items(company_id, person_id, kind, title, body, asked_by, channel_message_id)
  select k.company_id, m.person, 'channel_mention', left(coalesce(btrim(k.name),'general'),300), left(message,4000),
   left(coalesce(writer,''),120), saved
  from public.channel_message_mentions(ch, auth.uid(), message) m
  on conflict (channel_message_id, person_id) where channel_message_id is not null do nothing;
 return saved;
end $$;
revoke all on function public.post_channel_message(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.post_channel_message(uuid,uuid,text) to authenticated;

-- The mentioned Member opened the message from their list: their own item is done. Only their own, only in a channel they
-- are still in; a Reader (a Viewer included) does it, since reading a mention is not writing in the channel.
create function public.read_channel_mention(ch uuid, message bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare k public.channels; changed integer;
begin
 select * into k from public.channels where id=ch;
 if k.id is null or not public.in_channel(ch) then return false; end if;
 update public.waiting_items w set resolved_at=now()
  where w.company_id=k.company_id and w.person_id=auth.uid() and w.resolved_at is null and w.channel_message_id=message
   and exists(select 1 from public.channel_messages m where m.id=message and m.channel_id=ch);
 get diagnostics changed = row_count;
 return changed > 0;
end $$;
revoke all on function public.read_channel_mention(uuid,bigint) from public,anon,service_role;
grant execute on function public.read_channel_mention(uuid,bigint) to authenticated;
