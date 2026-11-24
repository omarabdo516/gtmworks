-- #675 (spec #667, ADR 0026): a team channel is archived, never deleted. Archived is a time and a person on the channel;
-- every message, Run and card in it stays. An Owner or a Manager in the channel archives and restores it through the
-- two functions below, so a direct call obeys the same rules as its details; the general channel is never archived.
-- Its Members still read it (the channel's read rules do not change), under Archived and not in their channel list, and
-- nobody writes in it until it is restored. A Member outside it sees nothing of it, the Owner included.
-- Additive, for the previous app version: two nullable columns, one table, one trigger, one restrictive log policy and
-- four functions; channel_sidebar and waiting_list keep their signatures. That version reads and lists channels as before,
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
-- stopped down its chain (stop_open_handovers), so nothing hands on; a started Run ends as stopped when it is next
-- closed. Its questions and requests close unanswered, its mentions stop waiting, and its handed steps wait on nobody
-- while it is archived (waiting_list). One Activity log row names who archived it. Refusals: P0002 channelNotFound (not
-- in it, another Company's, unknown); 42501 channelArchiveNotAllowed (the general channel, or a Member who is no Owner
-- or Manager). An archived channel answers nothing and changes nothing.
create function public.archive_channel(ch uuid) returns table(run text, profile text)
language plpgsql security definer set search_path='' as $$
declare k public.channels; m bigint; logged bigint; writer text;
begin
 if auth.uid() is null then raise exception 'channelArchiveNotAllowed' using errcode='42501'; end if;
 select * into k from public.channels x where x.id=ch for update;
 if k.id is null or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if k.kind<>'team' or not public.can_manage_company(k.company_id) then raise exception 'channelArchiveNotAllowed' using errcode='42501'; end if;
 if k.archived_at is not null then return; end if;
 update public.channels x set archived_at=now(), archived_by=auth.uid() where x.id=ch;
 update public.channel_runs r set outcome='stopped', closed_at=now()
  where r.channel_id=ch and r.outcome is null and r.run_id is null and r.attempts=0;
 for m in select x.id from public.channel_messages x where x.channel_id=ch and x.author='person'
   and (exists(select 1 from public.channel_runs r where r.message_id=x.id and r.outcome is null)
    or exists(select 1 from public.agent_handovers h where h.channel_message_id=x.id and h.state not in ('done','failed')))
   order by x.id loop
  return query select s.run, s.profile from public.stop_open_handovers(null,m) s where s.run is not null;
 end loop;
 return query select r.run_id, r.profile from public.channel_runs r where r.channel_id=ch and r.outcome is null and r.run_id is not null
  order by r.message_id, r.ordinal;
 update public.reply_cards x set state='closed' from public.channel_messages cm
  where cm.id=x.channel_message_id and cm.channel_id=ch and x.kind='question' and x.state in ('open','sending');
 update public.channel_permissions p set state='closed' where p.channel_id=ch and p.state in ('open','sending');
 update public.waiting_items w set resolved_at=now() from public.channel_messages cm
  where cm.id=w.channel_message_id and cm.channel_id=ch and w.company_id=k.company_id and w.resolved_at is null;
 insert into public.channel_archives(company_id,channel_id,actor_id,action) values (k.company_id,ch,auth.uid(),'archived') returning id into logged;
 select p.name into writer from public.people p where p.id=auth.uid();
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values (k.company_id,auth.uid(),'person',writer,'company','channel_archived',jsonb_build_object('channel_id',ch,'channel',k.name),'channel_archives',logged,now());
end $$;
revoke all on function public.archive_channel(uuid) from public,anon,service_role;
grant execute on function public.archive_channel(uuid) to authenticated;

-- Restores an archived team channel to its Members' channel lists, with one log row. Nothing starts: no Run, question
-- or handover comes back with it. Refusals as archive_channel, with 42501 channelRestoreNotAllowed.
create function public.restore_channel(ch uuid) returns void
language plpgsql security definer set search_path='' as $$
declare k public.channels; logged bigint; writer text;
begin
 if auth.uid() is null then raise exception 'channelRestoreNotAllowed' using errcode='42501'; end if;
 select * into k from public.channels x where x.id=ch for update;
 if k.id is null or not public.in_channel(ch) then raise exception 'channelNotFound' using errcode='P0002'; end if;
 if k.kind<>'team' or not public.can_manage_company(k.company_id) then raise exception 'channelRestoreNotAllowed' using errcode='42501'; end if;
 if k.archived_at is null then return; end if;
 update public.channels x set archived_at=null, archived_by=null where x.id=ch;
 insert into public.channel_archives(company_id,channel_id,actor_id,action) values (k.company_id,ch,auth.uid(),'restored') returning id into logged;
 select p.name into writer from public.people p where p.id=auth.uid();
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values (k.company_id,auth.uid(),'person',writer,'company','channel_restored',jsonb_build_object('channel_id',ch,'channel',k.name),'channel_archives',logged,now());
end $$;
revoke all on function public.restore_channel(uuid) from public,anon,service_role;
grant execute on function public.restore_channel(uuid) to authenticated;

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

-- 20270415100000's waiting_list: nothing in an archived channel waits on anyone (a handed step there has no closed
-- state, so it waits again only once the channel is restored).
create or replace function public.waiting_list(c uuid)
returns table(kind text, id bigint, title text, body text, asked_by text, card_id bigint, conversation_id uuid, created_at timestamptz)
language sql stable set search_path='' as $$
 select * from (
  select 'approval'::text, w.id, w.title, coalesce(a.name,''), ''::text, w.id, null::uuid, coalesce(w.review_entered_at,w.created_at)
   from public.work_cards w
   join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id and s.kind='review'
   left join public.approval_steps a on a.company_id=w.company_id and a.id=w.approval_step_id
   where w.company_id=c and w.approval_step_id is not null and public.approval_holds(c,w.approval_step_id)
  union all
  select i.kind, i.id, i.title, i.body, i.asked_by, i.card_id, i.conversation_id, i.created_at
   from public.waiting_items i where i.company_id=c and i.person_id=auth.uid() and i.resolved_at is null
  union all
  select 'agent_request'::text, r.id, r.agent_name, r.job, coalesce(p.name,''), null::bigint, null::uuid, r.created_at
   from public.lead_agent_requests r
   join public.members m on m.company_id=r.company_id and m.person_id=r.asked_by and m.removed_at is null
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and r.state='waiting' and public.is_company_owner(c)
  union all
  select r.kind, r.id, case r.kind when 'question' then r.content->>'question' else r.title end, ''::text, v.agent_name,
    (select w.id from public.work_cards w where w.company_id=c and w.conversation_id=r.conversation_id), r.conversation_id, r.created_at
   from public.reply_cards r
   join public.conversations v on v.id=r.conversation_id and v.company_id=r.company_id
   where r.company_id=c and r.kind in ('question','hand','permission') and v.person_id=auth.uid() and public.reply_card_waits(r)
  union all
  select 'channel_permission'::text, p.id, p.title, ''::text, r.agent_name, null::bigint, null::uuid, p.created_at
   from public.channel_permissions p
   join public.channel_runs r on r.message_id=p.message_id and r.ordinal=p.ordinal
   join public.channels k on k.id=p.channel_id and k.archived_at is null
   where p.company_id=c and p.state='open' and public.channel_permission_waits(p)
  union all
  select 'channel_question'::text, r.id, r.content->>'question', ''::text, cr.agent_name, null::bigint, null::uuid, r.created_at
   from public.reply_cards r
   join public.channel_messages m on m.id=r.channel_message_id
   join public.channels k on k.id=m.channel_id and k.archived_at is null
   join public.channel_runs cr on cr.message_id=r.channel_message_id and cr.ordinal=coalesce(r.channel_ordinal,1)
   where r.company_id=c and r.kind='question' and r.state='open' and cr.outcome is null
    and public.conversation_can_write(c) and public.in_channel(m.channel_id)
    and (r.addressed_to is null or r.addressed_to=auth.uid())
  union all
  select 'channel_hand'::text, r.id, r.title, ''::text, cr.agent_name, null::bigint, null::uuid, r.created_at
   from public.reply_cards r
   join public.channel_messages m on m.id=r.channel_message_id
   join public.channels k on k.id=m.channel_id and k.archived_at is null
   join public.channel_runs cr on cr.message_id=r.channel_message_id and cr.ordinal=coalesce(r.channel_ordinal,1)
   where r.company_id=c and r.kind='hand' and r.state='open'
    and public.conversation_can_write(c) and public.in_channel(m.channel_id)
  union all
  select 'agent_key'::text, k.id, g.name, ''::text, ''::text, null::bigint, null::uuid, k.created_at
   from public.agent_key_waits k
   join public.hermes_agents g on g.company_id=k.company_id and g.id=k.agent_id
   where k.company_id=c and public.agent_key_waits_shown(c)
  union all
  select 'agent_change'::text, p.id, g.name, p.change, b.name, null::bigint, null::uuid, p.created_at
   from public.agent_change_proposals p
   join public.hermes_agents g on g.company_id=p.company_id and g.id=p.agent_id
   join public.hermes_agents b on b.company_id=p.company_id and b.id=p.proposed_by
   where p.company_id=c and p.state in ('waiting','applying') and public.is_company_owner(c)
  union all
  select 'agent_access'::text, r.id, g.name, g.speciality, coalesce(p.name,''), null::bigint, null::uuid, r.pressed_at
   from public.agent_access_requests r
   join public.hermes_agents g on g.company_id=r.company_id and g.id=r.agent_id
   join public.members m on m.company_id=r.company_id and m.person_id=r.asked_by and m.removed_at is null
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and public.agent_access_waits(r)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;
