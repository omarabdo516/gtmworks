-- #675 (spec #667, ADR 0026): a team channel is archived, never deleted. Archived is a time and a person on the channel;
-- every message, Run and card in it stays. An Owner or a Manager in the channel archives and restores it through the
-- two functions below, so a direct call obeys the same rules as its details; the general channel is never archived.
-- Its Members still read it (the channel's read rules do not change), under Archived and not in their channel list, and
-- nobody writes in it until it is restored. A Member outside it sees nothing of it, the Owner included.
-- Additive, for the previous app version: two nullable columns, one table, one trigger, one restrictive log policy and
-- four functions; channel_sidebar, conversation_list and conversation_counts keep their signatures. That version reads and lists channels as before,
-- leaving an archived one in its list, and a message it sends there is refused like any other.
alter table public.channels add column archived_at timestamptz;
alter table public.channels add column archived_by uuid references public.people(id) on delete set null;
alter table public.channels add constraint channels_archived_by_archived check (archived_by is null or archived_at is not null);
alter table public.channels add constraint channels_archived_team check (archived_at is null or kind='team');

-- Each archive and restore of a channel, kept as the source of its Activity log row.
create table public.channel_archives (
 id bigint generated always as identity primary key,
 company_id uuid not null,
 channel_id uuid not null,
 actor_id uuid references public.people(id) on delete set null,
 action text not null check (action in ('archived','restored')),
 created_at timestamptz not null default now(),
 foreign key (channel_id, company_id) references public.channels(id, company_id)
);
alter table public.channel_archives enable row level security;
revoke all on public.channel_archives from anon,authenticated,service_role;

alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in
 ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit','note_runs','reply_cards',
  'member_invitations','reply_card_answers','channel_permissions','agent_handovers','channel_handover_replies','channel_cards','channel_replies',
  'channel_archives'));
-- A channel's archive row is read by that channel's Members alone, as the channel itself is: a Member outside it, the
-- Owner included, reads none. Every other row keeps the rules it had.
create policy channel_archive_rows on public.company_log as restrictive for select to authenticated
 using (case when source='channel_archives' then public.in_channel((details->>'channel_id')::uuid) else true end);

-- Nobody writes in an archived channel: a Member's message there is refused, whichever function writes it (a post, the
-- quiet message "Done it" writes). An Agent's reply to a Run that closes after the archive still lands: the Run's end is
-- kept, and it un-archives nothing.
create function public.refuse_archived_channel_message() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.channels k where k.id=new.channel_id and k.archived_at is not null) then
  raise exception 'channelArchived' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.refuse_archived_channel_message() from public,anon,authenticated,service_role;
create trigger channel_messages_not_archived before insert on public.channel_messages
 for each row when (new.author='person') execute function public.refuse_archived_channel_message();

-- What archiving the channel stops, for its one confirmation: each Agent working in it (an open Run or an open
-- Handover), and each question, request and handed step waiting on people there. Only a Member of the channel reads it.
create function public.channel_archive_stops(ch uuid) returns table(kind text, agent text, title text)
language sql stable security definer set search_path='' as $$
 select * from (
  select distinct 'run'::text, r.agent_name, ''::text from public.channel_runs r where r.channel_id=ch and r.outcome is null
  union
  select 'run'::text, a.name, ''::text from public.agent_handovers h
   join public.channel_messages m on m.id=h.channel_message_id
   join public.hermes_agents a on a.id=h.to_agent and a.company_id=h.company_id
   where m.channel_id=ch and h.state not in ('done','failed')
  union all
  select 'question'::text, cr.agent_name, x.content->>'question' from public.reply_cards x
   join public.channel_messages m on m.id=x.channel_message_id
   join public.channel_runs cr on cr.message_id=x.channel_message_id and cr.ordinal=coalesce(x.channel_ordinal,1)
   where m.channel_id=ch and x.kind='question' and x.state='open' and cr.outcome is null
  union all
  select 'permission'::text, cr.agent_name, p.title from public.channel_permissions p
   join public.channel_runs cr on cr.message_id=p.message_id and cr.ordinal=coalesce(p.ordinal,1)
   where p.channel_id=ch and p.state='open'
  union all
  select 'hand'::text, cr.agent_name, x.title from public.reply_cards x
   join public.channel_messages m on m.id=x.channel_message_id
   join public.channel_runs cr on cr.message_id=x.channel_message_id and cr.ordinal=coalesce(x.channel_ordinal,1)
   where m.channel_id=ch and x.kind='hand' and x.state='open'
 ) s(kind,agent,title)
 where auth.uid() is not null and public.in_channel(ch)
  and exists(select 1 from public.channels k where k.id=ch and k.archived_at is null);
$$;
revoke all on function public.channel_archive_stops(uuid) from public,anon,service_role;
grant execute on function public.channel_archive_stops(uuid) to authenticated;

-- Archives a team channel and answers the Runs to stop on their Agents' Engines (each with its profile), as Stop does
-- (stop_channel_message): every Run not started yet ends as stopped here, and every open Handover started from it ends as
-- stopped down its chain, so nothing hands on; a started Run ends as stopped when it is next closed. Its questions,
-- requests and handed steps close, and its mentions stop waiting, so nobody waits on it. One Activity log row names
-- who archived it. Refusals: P0002 channelNotFound (not in it, another Company's, unknown); 42501
-- channelArchiveNotAllowed (the general channel, or a Member who is no Owner or Manager). An archived channel answers
-- nothing and changes nothing.
create function public.archive_channel(c uuid, ch uuid) returns table(run text, profile text)
language plpgsql security definer set search_path='' as $$
declare k public.channels; logged bigint; writer text;
begin
 if auth.uid() is null then raise exception 'channelArchiveNotAllowed' using errcode='42501'; end if;
 select * into k from public.channels x where x.id=ch for update;
 if k.id is null or k.company_id is distinct from c or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if k.kind<>'team' or not public.can_manage_company(k.company_id) then raise exception 'channelArchiveNotAllowed' using errcode='42501'; end if;
 if k.archived_at is not null then return; end if;
 update public.channels x set archived_at=now(), archived_by=auth.uid() where x.id=ch;
 -- Its work stops as archiving the channel's Card stops it (#671, stop_card_work): every Run not started yet ends as
 -- stopped, every open Handover started there ends as stopped down its chain, and its questions, requests and handed
 -- steps close. The started Runs are kept for the worker to stop (stopped_runs) and are answered to stop now.
 perform public.stop_card_work(k.company_id,null,null,ch);
 return query select r.run_id, r.profile from public.channel_runs r where r.channel_id=ch and r.outcome is null and r.run_id is not null
  order by r.message_id, r.ordinal;
 update public.waiting_items w set resolved_at=now() from public.channel_messages cm
  where cm.id=w.channel_message_id and cm.channel_id=ch and w.company_id=k.company_id and w.resolved_at is null;
 insert into public.channel_archives(company_id,channel_id,actor_id,action) values (k.company_id,ch,auth.uid(),'archived') returning id into logged;
 select p.name into writer from public.people p where p.id=auth.uid();
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values (k.company_id,auth.uid(),'person',writer,'company','channel_archived',jsonb_build_object('channel_id',ch,'channel',k.name),'channel_archives',logged,now());
end $$;
revoke all on function public.archive_channel(uuid,uuid) from public,anon,service_role;
grant execute on function public.archive_channel(uuid,uuid) to authenticated;

-- Restores an archived team channel to its Members' channel lists, with one log row. Nothing starts: no Run, question
-- or handover comes back with it. Refusals as archive_channel, with 42501 channelRestoreNotAllowed.
create function public.restore_channel(c uuid, ch uuid) returns void
language plpgsql security definer set search_path='' as $$
declare k public.channels; logged bigint; writer text;
begin
 if auth.uid() is null then raise exception 'channelRestoreNotAllowed' using errcode='42501'; end if;
 select * into k from public.channels x where x.id=ch for update;
 if k.id is null or k.company_id is distinct from c or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if k.kind<>'team' or not public.can_manage_company(k.company_id) then raise exception 'channelRestoreNotAllowed' using errcode='42501'; end if;
 if k.archived_at is null then return; end if;
 update public.channels x set archived_at=null, archived_by=null where x.id=ch;
 insert into public.channel_archives(company_id,channel_id,actor_id,action) values (k.company_id,ch,auth.uid(),'restored') returning id into logged;
 select p.name into writer from public.people p where p.id=auth.uid();
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values (k.company_id,auth.uid(),'person',writer,'company','channel_restored',jsonb_build_object('channel_id',ch,'channel',k.name),'channel_archives',logged,now());
end $$;
revoke all on function public.restore_channel(uuid,uuid) from public,anon,service_role;
grant execute on function public.restore_channel(uuid,uuid) to authenticated;

-- The caller's archived channels in one Company, newest archived first, with who archived each and the newest message:
-- the Archived list. Only channels the caller is in; anyone outside the Company reads nothing.
create function public.archived_channels(c uuid)
returns table(id uuid, name text, archived_at timestamptz, archived_by uuid, archived_by_name text, last_body text, last_at timestamptz)
language sql stable security definer set search_path='' as $$
 select k.id, k.name, k.archived_at, k.archived_by, coalesce(p.name,''), l.body, l.created_at
 from public.channels k
  left join public.people p on p.id=k.archived_by
  left join lateral (select x.body, x.created_at from public.channel_messages x where x.channel_id=k.id and x.hand_card is null
   order by x.id desc limit 1) l on true
 where k.company_id=c and k.archived_at is not null and auth.uid() is not null and public.in_channel(k.id)
 order by k.archived_at desc, k.id;
$$;
revoke all on function public.archived_channels(uuid) from public,anon,service_role;
grant execute on function public.archived_channels(uuid) to authenticated;

-- 20270327000000's channel_sidebar: the caller's current channels only, so an archived one and its unread count leave
-- the list.
create or replace function public.channel_sidebar(c uuid) returns table(id uuid, kind text, name text, unread integer)
language sql stable security definer set search_path='' as $$
 select k.id, k.kind, k.name, (select count(*)::int from public.channel_messages m where m.channel_id=k.id
   and m.person_id is distinct from auth.uid() and m.hand_card is null
   and m.id > greatest(coalesce((select r.read_through from public.channel_reads r where r.channel_id=k.id and r.person_id=auth.uid()),0),
                       coalesce((select p.joined_through from public.channel_people p where p.channel_id=k.id and p.person_id=auth.uid()),0)))
 from public.channels k
 where k.company_id=c and k.archived_at is null and auth.uid() is not null and public.in_channel(k.id)
 order by k.kind='general' desc, k.created_at, k.id;
$$;

-- 20270415999988's All conversations (#673): an archived channel is in the Archived list, not the current one, and each
-- list's count follows (design-reference-card: renderConvos, where a channel is archived and restored as a Conversation
-- is). An archived Conversation (#674, 20270415999991) is in the Archived list too. Every other row is as #673 reads it.
create or replace function public.conversation_list(c uuid, q text default null, archived boolean default false, after_at timestamptz default null,
 after_id uuid default null, lim integer default 50, morning text default null, general text default null)
returns table(kind text, id uuid, agent_id uuid, agent_name text, connection_id uuid, title text, good_morning_day date, channel_kind text, last_at timestamptz, last_body text)
language sql stable security definer set search_path='' as $$
 with wanted as (select nullif(public.search_fold(coalesce(q,'')),'') as fold),
 listed as (
  select 'conversation'::text as kind, v.id, v.agent_id, v.agent_name, v.good_morning_day, null::text as channel_kind, null::text as name, v.last_message_at as last_at
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
revoke all on function public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text) to authenticated;

-- How many rows each of All conversations' two lists holds for the reader: `current` and `archived`, the reader's own
-- Conversations (#674) and the channels they are in alike.
create or replace function public.conversation_counts(c uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('current',
  (select count(*) from public.own_conversations(c) v where v.archived_at is null)
  +(select count(*) from public.channels k where k.company_id=c and k.archived_at is null and public.in_channel(k.id)),
  'archived',(select count(*) from public.own_conversations(c) v where v.archived_at is not null)
  +(select count(*) from public.channels k where k.company_id=c and k.archived_at is not null and public.in_channel(k.id)));
$$;
revoke all on function public.conversation_counts(uuid) from public,anon,service_role;
grant execute on function public.conversation_counts(uuid) to authenticated;
