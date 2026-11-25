-- #702 (spec #694, ADR 0027): a removed Agent keeps its face in history. Its look already outlives it by its id
-- (agent_looks); now every record of it keeps that id, and its name is kept beside its look once it is removed, so a
-- Conversation, a channel, a Handover, a Card and the log show it in the look it had, the same in each, also to a reader
-- it was hidden from where they may read the record. A removed Agent hides nothing (agent_visible_to), and nothing of it
-- becomes readable but its name and its look.
--
-- - agent_looks.kept_name: the Agent's name, written as it is removed. A living Agent has none, so a hidden one is never
--   named to a Member it is hidden from (ADR 0027: the look names nobody).
-- - conversations, channel_runs, work_cards: agent_id stays the live link, null once the Agent is removed (the Conversation
--   is then detached, as before); kept_agent_id is the Agent the record was made with, kept through the removal. A
--   person who lets a Card's Agent go clears it with agent_id. Messages already keep their Agent's id with no key.
-- - agent_handovers: a Handover was deleted with either Agent (on delete cascade). A finished one is history and stays,
--   by the Agents' ids with no key, as messages do; one still moving goes with its Agent, as before, since no Agent is
--   left to finish it.
--
-- Only adds (ADR 0023): new columns filled by triggers, so the previous release's inserts keep the id too; the readers
-- replaced keep their signatures and draw a removed Agent's connection as its id, a face the previous release can draw.

alter table public.agent_looks add column kept_name text;

alter table public.conversations add column kept_agent_id uuid;
alter table public.channel_runs add column kept_agent_id uuid;
alter table public.work_cards add column kept_agent_id uuid;

-- Records made before this change: each keeps the Agent it still names. A Conversation or a channel call detached
-- earlier names its Agent where that Agent's own reply does; one with no reply names none, and draws its name's letter.
update public.conversations c set kept_agent_id=coalesce(c.agent_id,(select m.agent_id from public.conversation_messages m
 where m.conversation_id=c.id and m.author='agent' and m.agent_id is not null and m.author_name=c.agent_name order by m.created_at,m.id limit 1));
update public.channel_runs r set kept_agent_id=coalesce(r.agent_id,(select m.agent_id from public.channel_messages m
 where m.reply_to=r.message_id and m.author='agent' and m.agent_id is not null and m.author_name=r.agent_name order by m.id limit 1));
update public.work_cards set kept_agent_id=agent_id where agent_id is not null;

-- The record keeps the Agent it is made with. agent_id going null keeps it when the Agent is gone (its removal sets it
-- null after the Agent's row is deleted) and clears it when the Agent is still there (a person let it go).
create function public.keep_record_agent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.agent_id is not null then new.kept_agent_id:=new.agent_id;
 elsif tg_op='INSERT' or exists(select 1 from public.hermes_agents a where a.id=old.agent_id) then new.kept_agent_id:=null;
 else new.kept_agent_id:=old.kept_agent_id; end if;
 return new;
end $$;
revoke all on function public.keep_record_agent() from public,anon,authenticated,service_role;
create trigger conversations_keep_agent before insert or update on public.conversations for each row execute function public.keep_record_agent();
create trigger channel_runs_keep_agent before insert or update on public.channel_runs for each row execute function public.keep_record_agent();
create trigger work_cards_keep_agent before insert or update on public.work_cards for each row execute function public.keep_record_agent();
grant select (kept_agent_id) on public.channel_runs to authenticated;

-- A finished Handover outlives its Agents.
alter table public.agent_handovers drop constraint agent_handovers_from_agent_fkey;
alter table public.agent_handovers drop constraint agent_handovers_to_agent_fkey;

-- As an Agent is removed: its name is kept beside its look, and its Handovers still moving go with it.
create function public.keep_removed_agent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.agent_looks set kept_name=old.name where agent_id=old.id and company_id=old.company_id;
 delete from public.agent_handovers where company_id=old.company_id and (from_agent=old.id or to_agent=old.id) and state not in ('done','failed');
 return old;
end $$;
revoke all on function public.keep_removed_agent() from public,anon,authenticated,service_role;
create trigger agent_removed_keeps_face before delete on public.hermes_agents for each row execute function public.keep_removed_agent();

-- The readers of Handovers name a removed Agent by its kept name. 20270415995000's conversation_handovers.
create or replace function public.conversation_handovers(conversation uuid)
returns table(id bigint, run text, from_agent uuid, from_name text, from_connection uuid, to_agent uuid, to_name text,
 to_connection uuid, goal text, answer text, state text, target_outcome text, answers_person boolean, created_at timestamptz, answered_at timestamptz,
 parent bigint, stopped boolean)
language sql stable security definer set search_path='' as $$
 select h.id,h.run_id,h.from_agent,coalesce(f.name,fl.kept_name),coalesce(f.connection_id,h.from_agent),h.to_agent,coalesce(t.name,tl.kept_name),coalesce(t.connection_id,h.to_agent),h.goal,
  case when h.target_outcome='completed' and not h.answers_person then h.summary end,
  h.state,h.target_outcome,h.answers_person,h.created_at,h.target_closed_at,h.parent_id,
  coalesce(h.target_outcome='stopped' or h.follow_up_outcome='stopped',false)
 from public.agent_handovers h
  join public.conversations c on c.id=h.conversation_id and c.company_id=h.company_id
  left join public.hermes_agents f on f.id=h.from_agent and f.company_id=h.company_id
  left join public.agent_looks fl on fl.agent_id=h.from_agent and fl.company_id=h.company_id
  left join public.hermes_agents t on t.id=h.to_agent and t.company_id=h.company_id
  left join public.agent_looks tl on tl.agent_id=h.to_agent and tl.company_id=h.company_id
 where h.conversation_id=conversation_handovers.conversation and auth.uid() is not null and c.person_id=auth.uid()
  and public.is_member(c.company_id) and public.can_see_agent(c.company_id,c.agent_id)
  and coalesce(f.name,fl.kept_name) is not null and coalesce(t.name,tl.kept_name) is not null
 order by h.created_at,h.id;
$$;

-- channel_handovers as 20270415999950 left it (no_access among the model causes).
create or replace function public.channel_handovers(ch uuid)
returns table(id bigint, message bigint, from_agent uuid, from_name text, from_connection uuid, to_agent uuid, to_name text,
 to_connection uuid, goal text, summary text, reply text, state text, target_outcome text, created_at timestamptz, answered_at timestamptz,
 closed_at timestamptz, no_model boolean, stopped boolean, model_end text, model_agent text)
language sql stable security definer set search_path='' as $$
 select h.id,h.channel_message_id,h.from_agent,n.from_name,coalesce(f.connection_id,h.from_agent),h.to_agent,n.to_name,coalesce(t.connection_id,h.to_agent),h.goal,h.summary,h.reply,
  h.state,h.target_outcome,h.created_at,h.target_closed_at,h.closed_at,
  coalesce(e.ended='no_model',false),coalesce(h.target_outcome='stopped' or h.follow_up_outcome='stopped',false),e.ended,case when e.ended is not null then case when h.follow_up_outcome is not null then n.from_name else n.to_name end end
 from public.agent_handovers h
  join public.channel_messages m on m.id=h.channel_message_id
  left join public.hermes_agents f on f.id=h.from_agent and f.company_id=h.company_id
  left join public.agent_looks fl on fl.agent_id=h.from_agent and fl.company_id=h.company_id
  left join public.hermes_agents t on t.id=h.to_agent and t.company_id=h.company_id
  left join public.agent_looks tl on tl.agent_id=h.to_agent and tl.company_id=h.company_id
  cross join lateral (select coalesce(f.name,fl.kept_name) as from_name,coalesce(t.name,tl.kept_name) as to_name) n
  cross join lateral (select case when h.state in ('done','failed') and h.reply is null
   and coalesce(h.follow_up_outcome,h.target_outcome) in ('no_model','no_credit','key_refused','model_missing','no_access')
   then coalesce(h.follow_up_outcome,h.target_outcome) end as ended) e
 where m.channel_id=ch and h.company_id=m.company_id and auth.uid() is not null and public.in_channel(ch)
  and n.from_name is not null and n.to_name is not null
 order by h.id desc;
$$;

-- 20270120000000's crew: a removed Agent that worked on a Card stays in its crew, by the name kept beside its look.
create or replace function public.crew(card public.work_cards) returns uuid[]
language sql stable set search_path='' as $$
 select coalesce(array_agg(x.agent_id order by x.first_at,x.agent_id),'{}') from (
  select l.agent_id,min(l.created_at) first_at from public.company_log l
  where l.company_id=card.company_id and l.card_id=card.id
   and (exists(select 1 from public.hermes_agents h where h.id=l.agent_id and h.company_id=l.company_id)
    or exists(select 1 from public.agent_looks k where k.agent_id=l.agent_id and k.company_id=l.company_id and k.kept_name is not null))
  group by l.agent_id) x;
$$;

-- 20270415999995's conversation_list: a Conversation names the Agent it keeps, removed or not, for its face; its
-- connection stays the living Agent's only.
create or replace function public.conversation_list(c uuid, q text default null, archived boolean default false, after_at timestamptz default null,
 after_id uuid default null, lim integer default 50, morning text default null, general text default null)
returns table(kind text, id uuid, agent_id uuid, agent_name text, connection_id uuid, title text, good_morning_day date, channel_kind text, last_at timestamptz, last_body text)
language sql stable security definer set search_path='' as $$
 with wanted as (select nullif(public.search_fold(coalesce(q,'')),'') as fold),
 listed as (
  select 'conversation'::text as kind, v.id, coalesce(v.agent_id,v.kept_agent_id) as agent_id, v.agent_name, v.good_morning_day, null::text as channel_kind, null::text as name, v.last_message_at as last_at
  from public.own_conversations(c) v
  where (v.archived_at is not null)=archived
  union all
  select 'channel', k.id, null, null, null, k.kind, k.name,
   coalesce((select m.created_at from public.channel_messages m where m.channel_id=k.id order by m.id desc limit 1),k.created_at)
  from public.channels k
  where k.company_id=c and public.in_channel(k.id) and (k.archived_at is not null)=archived
 ),
 page as (
  select t.* from listed t, wanted w
  where (after_at is null or (t.last_at,t.id)<(after_at,after_id))
   and case when w.fold is null then true
    else position(w.fold in public.search_fold(coalesce(case when t.kind='channel' then coalesce(t.name,general) when t.good_morning_day is not null then morning
     else public.conversation_title(t.id,t.agent_name) end,'')))>0 end
  order by t.last_at desc, t.id desc
  limit least(greatest(coalesce(lim,50),1),100)
 )
 select p.kind, p.id, p.agent_id, p.agent_name, h.connection_id,
  case when p.kind='channel' then p.name when p.good_morning_day is null then public.conversation_title(p.id,p.agent_name) end, p.good_morning_day, p.channel_kind, p.last_at,
  case when p.kind='conversation'
   then (select m.body from public.conversation_messages m where m.conversation_id=p.id and m.body<>'' and m.hand_card is null order by m.id desc limit 1)
   else (select m.body from public.channel_messages m where m.channel_id=p.id and m.body<>'' and m.hand_card is null order by m.id desc limit 1) end
 from page p left join public.hermes_agents h on h.id=p.agent_id and h.company_id=c
 order by p.last_at desc, p.id desc;
$$;
