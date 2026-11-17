-- #165: a pending permission request (#163) waits on a person, so it is in their "Waiting on you". In a Conversation it
-- waits on the Conversation's person while they may write and see its Agent, as a handed step does (reply_card_waits),
-- so waiting_list lists it and the chat's Card reads it as its wait (card_wait): the board's first column, the sidebar
-- count and Numbers all read that one list. In a channel an Agent called by a Member may ask too: one channel_permissions
-- row per request, read by everyone in the channel and decided only by the Member who called the Agent, who alone has it
-- in their list. Either leaves the list when its request is allowed, refused, or closed by the Engine or the Run's end,
-- since only an open request waits, and an open request is never opened again.
--
-- Only adds a table and functions and replaces functions with the same signatures; no row is rewritten. The previous app
-- version runs against it: waiting_list keeps its columns, and that app draws the new kinds as plain rows opening their
-- chat (a channel's opens the board); its channel driver refuses a channel's request at once, so it keeps no row here.

-- As #146's, and a permission request waits while it is open and its Run has not ended, on a person who may still write
-- and sees its Agent.
create or replace function public.reply_card_waits(card public.reply_cards) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.reply_cards r
  join public.conversations v on v.id=r.conversation_id and v.company_id=r.company_id
  where r.id=card.id and r.state='open' and public.is_member(v.company_id)
   and (v.person_id=auth.uid() or exists(select 1 from public.work_cards w where w.company_id=v.company_id and w.conversation_id=v.id and public.can_see_card(w.company_id,w.id)))
   and case r.kind
    when 'question' then not exists(select 1 from public.conversation_usage u where u.conversation_id=r.conversation_id and u.run_id=r.run_id)
    when 'hand' then exists(select 1 from public.members m where m.company_id=v.company_id and m.person_id=v.person_id and m.removed_at is null and m.role<>'viewer')
     and public.agent_visible_to(v.company_id,v.person_id,v.agent_id)
    when 'permission' then not exists(select 1 from public.conversation_usage u where u.conversation_id=r.conversation_id and u.run_id=r.run_id)
     and exists(select 1 from public.members m where m.company_id=v.company_id and m.person_id=v.person_id and m.removed_at is null and m.role<>'viewer')
     and public.agent_visible_to(v.company_id,v.person_id,v.agent_id)
    else false end);
$$;

-- As #146's, and a waiting permission request is a Card's wait too, titled with what it asks.
create or replace function public.card_wait(card public.work_cards) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('person',v.person_id,'kind',r.kind,'title',case r.kind when 'question' then r.content->>'question' else r.title end)
 from public.work_cards w
 join public.conversations v on v.id=w.conversation_id and v.company_id=w.company_id
 join public.reply_cards r on r.conversation_id=v.id and r.company_id=v.company_id and r.kind in ('question','hand','permission') and r.state='open'
 where w.conversation_id is not null and w.id=card.id and w.company_id=card.company_id and public.is_member(w.company_id)
  and public.can_see_card(w.company_id,w.id) and public.reply_card_waits(r)
 order by r.created_at desc, r.id desc limit 1;
$$;

-- A channel's permission request: the Run of one message that called an Agent (channel_runs) stops to ask. As a
-- Conversation's card (#163): `request_id` the Engine's id, `content` its words and the choices it takes, and `state`
-- its life (open, sending once the caller's choice is claimed, then decided or closed).
create table public.channel_permissions (
 id bigint generated always as identity primary key,
 company_id uuid not null,
 channel_id uuid not null,
 message_id bigint not null references public.channel_runs(message_id),
 run_id text not null,
 request_id text not null check (length(request_id) between 1 and 200),
 title text not null check (length(title) between 1 and 100),
 content jsonb not null,
 state text not null,
 decided_by uuid references public.people(id),
 decided_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key (channel_id, company_id) references public.channels(id, company_id),
 unique (message_id, request_id),
 constraint channel_permissions_valid check (public.reply_card_valid('permission',state,content)),
 constraint channel_permissions_decided check ((decided_by is null)=(decided_at is null) and (decided_at is not null)=(content ? 'choice'))
);
create index channel_permissions_open on public.channel_permissions(message_id) where state in ('open','sending');
-- Everyone in the channel reads the request under the Agent's turn, as they read its reply. Only the functions below
-- write.
alter table public.channel_permissions enable row level security;
create policy channel_permissions_read on public.channel_permissions for select to authenticated using (public.in_channel(channel_id));
revoke all on public.channel_permissions from public,anon,authenticated,service_role;
grant select on public.channel_permissions to authenticated;

-- Whether a channel's request waits on the caller: open, its Run not ended, and the caller is the Member whose message
-- called the Agent, may still write, and still calls that Agent in this channel. Read again by id.
create function public.channel_permission_waits(request public.channel_permissions) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.channel_permissions p
  join public.channel_runs r on r.message_id=p.message_id and r.outcome is null
  join public.channel_messages m on m.id=p.message_id
  where p.id=request.id and p.state='open' and m.person_id=auth.uid() and public.conversation_can_write(p.company_id)
   and r.agent_id is not null and public.channel_agent(p.channel_id,auth.uid(),r.agent_id));
$$;
revoke all on function public.channel_permission_waits(public.channel_permissions) from public,anon,service_role;
grant execute on function public.channel_permission_waits(public.channel_permissions) to authenticated;

-- track_run_permission's twin for a channel's Run (#163 says why each rule is as it is): the closer tells what its read
-- of the message's Run showed, and is answered the claimed choices still to deliver.
create function public.track_channel_permission(message bigint, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz default null, run_profile text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare called public.channel_runs; asked text:=asking->>'id'; own boolean; kept jsonb; named text;
begin
 perform pg_advisory_xact_lock(hashtextextended('channel_permission:'||message::text,0));
 select * into called from public.channel_runs where message_id=message and run_id=run;
 if not found then return '[]'::jsonb; end if;
 update public.channel_permissions p set state='closed' where p.message_id=message
  and ((ended or called.outcome is not null) and p.state in ('open','sending') or p.state='open' and p.request_id is distinct from asked and p.created_at<read_started_at);
 if asked is not null and not ended and called.outcome is null then
  own:=coalesce(run_profile=public.agent_engine_profile(called.agent_id),false);
  kept:=jsonb_build_object('description',asking->'description','command',asking->'command','choices',
   case when jsonb_typeof(asking->'choices')='array' then coalesce((select jsonb_agg(o order by n) from jsonb_array_elements(asking->'choices') with ordinality x(o,n)
    where own or o<>'"always"'::jsonb),'[]'::jsonb) else asking->'choices' end);
  if length(asked) between 1 and 200 and public.reply_card_valid('permission','open',kept) then
   named:=btrim(case when btrim(kept->>'description',E' \t\r\n')<>'' then kept->>'description' else kept->>'command' end,E' \t\r\n');
   insert into public.channel_permissions(company_id,channel_id,message_id,run_id,request_id,title,content,state,created_at)
    values(called.company_id,called.channel_id,message,run,asked,
     case when length(named)<=100 then named else rtrim(left(named,99),E' \t\r\n')||'…' end,kept,'open',greatest(read_started_at,coalesce(read_ended_at,read_started_at)))
    on conflict do nothing;
  end if;
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('card',p.id,'permission',p.request_id,'choice',p.content->'choice') order by p.id) from public.channel_permissions p
  where p.message_id=message and p.run_id=run and p.state='sending'),'[]'::jsonb);
end $$;
revoke all on function public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text) to service_role;

-- The one claim, by the Member whose message called the Agent, of a choice their role may send (permission_choices) and
-- the Engine offered. Anyone else in the channel, a Viewer among them, is refused; anyone outside it finds nothing. The
-- first press is kept, as decide_permission keeps it.
create function public.decide_channel_permission(c uuid, request bigint, choice text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare asked public.channel_permissions; called public.channel_runs; caller uuid;
begin
 select * into asked from public.channel_permissions p where p.id=request and p.company_id=c and public.in_channel(p.channel_id) for update;
 if not found then raise exception 'channelNotFound' using errcode='P0002'; end if;
 select * into called from public.channel_runs where message_id=asked.message_id;
 select person_id into caller from public.channel_messages where id=asked.message_id;
 if caller is distinct from auth.uid() or not public.conversation_can_write(c) or called.agent_id is null
  or not public.channel_agent(asked.channel_id,auth.uid(),called.agent_id) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if asked.state in ('sending','decided') then
  return jsonb_build_object('state','decided','choice',asked.content->'choice','at',asked.decided_at,'first',false); end if;
 if asked.state<>'open' then return jsonb_build_object('state','closed','choice',null,'at',null,'first',false); end if;
 if called.outcome is not null then
  update public.channel_permissions set state='closed' where id=asked.id;
  return jsonb_build_object('state','closed','choice',null,'at',null,'first',false);
 end if;
 if decide_channel_permission.choice is null or not asked.content->'choices' ? decide_channel_permission.choice then raise exception 'permissionChoiceInvalid' using errcode='22023'; end if;
 if not decide_channel_permission.choice=any(public.permission_choices(c)) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 update public.channel_permissions set state='sending',content=asked.content||jsonb_build_object('choice',decide_channel_permission.choice),decided_by=auth.uid(),decided_at=now()
  where id=asked.id returning * into asked;
 return jsonb_build_object('state','decided','choice',decide_channel_permission.choice,'at',asked.decided_at,'first',true);
end $$;
revoke all on function public.decide_channel_permission(uuid,bigint,text) from public,anon,service_role;
grant execute on function public.decide_channel_permission(uuid,bigint,text) to authenticated;

alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit','note_runs','reply_cards','member_invitations','reply_card_answers','channel_permissions'));

-- settle_permission's twin: what became of a delivered choice, and a decided one logged once, privately, as #163 logs it.
create function public.settle_channel_permission(card bigint, verdict text) returns text
language plpgsql security definer set search_path='' as $$
declare asked public.channel_permissions;
begin
 if verdict is null or verdict not in ('decided','closed') then raise exception 'permissionVerdictInvalid' using errcode='22023'; end if;
 select * into asked from public.channel_permissions where id=card for update;
 if not found then return null; end if;
 if not (asked.state='sending' or verdict='decided' and asked.state='closed' and asked.content ? 'choice') then return asked.state; end if;
 update public.channel_permissions set state=verdict where id=asked.id;
 if verdict='decided' then
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
   values(asked.company_id,asked.decided_by,'person',(select name from public.people where id=asked.decided_by),'agent',
    (select r.agent_id from public.channel_runs r where r.message_id=asked.message_id),'agent_permission_decided',
    jsonb_build_object('permission',jsonb_build_object('text',case when btrim(asked.content->>'description',E' \t\r\n')<>'' then asked.content->'description' else asked.content->'command' end,
     'choice',asked.content->'choice'),'private',true,'teller',asked.decided_by),
    'channel_permissions',asked.id,asked.decided_at)
   on conflict (source,source_id) do nothing;
 end if;
 return verdict;
end $$;
revoke all on function public.settle_channel_permission(bigint,text) from public,anon,authenticated;
grant execute on function public.settle_channel_permission(bigint,text) to service_role;

-- A channel Run's end closes its open and claimed requests, under track_channel_permission's lock.
create function public.close_ended_channel_permissions() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('channel_permission:'||new.message_id::text,0));
 update public.channel_permissions set state='closed' where message_id=new.message_id and state in ('open','sending');
 return null;
end $$;
revoke all on function public.close_ended_channel_permissions() from public,anon,authenticated,service_role;
create trigger channel_runs_close_permissions after update of outcome on public.channel_runs for each row
 when (old.outcome is null and new.outcome is not null) execute function public.close_ended_channel_permissions();

-- As #146's, and a Conversation's permission request and a channel's wait on the person who may decide them.
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
   join public.channel_runs r on r.message_id=p.message_id
   where p.company_id=c and p.state='open' and public.channel_permission_waits(p)
  union all
  select 'agent_key'::text, k.id, g.name, ''::text, ''::text, null::bigint, null::uuid, k.created_at
   from public.agent_key_waits k
   join public.hermes_agents g on g.company_id=k.company_id and g.id=k.agent_id
   where k.company_id=c and public.agent_key_waits_shown(c)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;
