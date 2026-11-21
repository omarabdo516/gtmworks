-- #166: an Agent's "Standing permissions", what it may do without asking again, each with "Revoke". The list itself is
-- the Engine's (its own profile's command_allowlist, lib/hermes.mjs) and gtmworks keeps no copy of it; what gtmworks keeps
-- is its own record of each decision (#163): who answered "Always allow" and when. This adds to that record what an
-- always answer keeps in the Engine (`allows`, the request's entries as the driver reads them), so a standing entry can
-- say who allowed it, and one row in the Company log for a revoke. The Owner and Managers revoke; everyone who sees the
-- Agent reads the rows.
--
-- Nothing existing is rewritten: `allows` is new and empty on every row there, and a request kept by the previous app
-- version (its driver sends no `allows`) keeps none, so its entry reads without who allowed it. The previous app calls
-- both tracking functions as before and reads neither new function.

-- What an always answer keeps, on a request that offers always: at most 32 entries, each as the Engine keys it.
create function public.permission_allows_valid(allows text[]) returns boolean language sql immutable set search_path='' as $$
 select allows is null or cardinality(allows) between 1 and 32 and array_ndims(allows)=1
  and not exists(select 1 from unnest(allows) a where a is null or length(a) not between 1 and 1000 or btrim(a)<>a);
$$;
revoke all on function public.permission_allows_valid(text[]) from public,anon,authenticated,service_role;
alter table public.reply_cards add column allows text[],
 add constraint reply_cards_allows check ((allows is null or kind='permission' and content->'choices' ? 'always') and public.permission_allows_valid(allows));
alter table public.channel_permissions add column allows text[],
 add constraint channel_permissions_allows check ((allows is null or content->'choices' ? 'always') and public.permission_allows_valid(allows));

-- The entries of `asking` an always answer keeps, when the request kept offers always; otherwise none.
create function public.permission_allows_of(asking jsonb, kept jsonb) returns text[] language sql immutable set search_path='' as $$
 select case when kept->'choices' ? 'always' and jsonb_typeof(asking->'allows')='array' and jsonb_array_length(asking->'allows') between 1 and 32
  and not exists(select 1 from jsonb_array_elements(asking->'allows') a where jsonb_typeof(a)<>'string')
  then (select array_agg(a order by n) from jsonb_array_elements_text(asking->'allows') with ordinality x(a,n)) end;
$$;
revoke all on function public.permission_allows_of(jsonb,jsonb) from public,anon,authenticated,service_role;

-- A revoke holds its Agent for a moment (#166): the Engine's config route replaces the whole list and has no versioned write,
-- so while one revoke reads and writes the list, no other revoke of that Agent runs and no Always allow of it is handed
-- to the Engine (the tracking functions below keep it claimed, and the next read delivers it). A hold ends when its
-- revoke ends, or after a minute when the server that took it went away. It is read and written by these functions only.
create table public.agent_permission_revokes (
 agent_id uuid primary key references public.hermes_agents(id) on delete cascade,
 company_id uuid not null,
 held_by uuid not null,
 held_until timestamptz not null
);
alter table public.agent_permission_revokes enable row level security;
revoke all on public.agent_permission_revokes from public,anon,authenticated,service_role;

-- Each entry a revoke took out of an Agent's profile, and when (#166): shared by every server, and written before the
-- Company log's row, with nothing a label could make it refuse. A grant older than its entry's last revoke here names
-- no one (agent_permission_grants) and is never written back by a later revoke (agent_permission_inflight), whatever
-- became of the log row. Read and written by these functions only.
create table public.agent_permission_revoked (
 agent_id uuid not null references public.hermes_agents(id) on delete cascade,
 company_id uuid not null,
 entry text not null check (length(entry) between 1 and 1000),
 revoked_at timestamptz not null,
 -- The record this one replaced, if any: a revoke the Engine did not take puts it back rather than leave no record.
 previous_at timestamptz,
 primary key (agent_id, entry)
);
alter table public.agent_permission_revoked enable row level security;
revoke all on public.agent_permission_revoked from public,anon,authenticated,service_role;

create function public.permission_revoke_held(agent uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agent_permission_revokes h where h.agent_id=agent and h.held_until>now());
$$;
revoke all on function public.permission_revoke_held(uuid) from public,anon,authenticated,service_role;

-- 20270203000001's track_run_permission, keeping the request's `allows` (an invalid one is kept as none), and handing
-- out no Always allow of an Agent a revoke holds.
create or replace function public.track_run_permission(conversation uuid, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz default null, run_profile text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked text:=asking->>'id'; own boolean; kept jsonb; named text; handed jsonb; keeps text[];
begin
 -- The lock a Run's end takes (close_ended_run_permissions), so a request is never kept after its Run has ended.
 perform pg_advisory_xact_lock(hashtextextended('permission_run:'||conversation::text||':'||run,0));
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run) then return '[]'::jsonb; end if;
 update public.reply_cards r set state='closed' where r.conversation_id=conversation and r.kind='permission'
  and (r.run_id=run and (ended and r.state in ('open','sending') or r.state='open' and r.call_id is distinct from asked and r.created_at<read_started_at)
   or r.state in ('open','sending') and r.run_id<>run and exists(select 1 from public.conversation_run_ends u where u.conversation_id=conversation and u.run_id=r.run_id));
 if asked is not null and not ended and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=conversation and u.run_id=run) then
  own:=coalesce(run_profile=public.agent_engine_profile(talk.agent_id),false);
  kept:=jsonb_build_object('description',asking->'description','command',asking->'command','choices',
   case when jsonb_typeof(asking->'choices')='array' then coalesce((select jsonb_agg(o order by n) from jsonb_array_elements(asking->'choices') with ordinality x(o,n)
    where own or o<>'"always"'::jsonb),'[]'::jsonb) else asking->'choices' end);
  if length(asked) between 1 and 200 and public.reply_card_valid('permission','open',kept) then
   keeps:=public.permission_allows_of(asking,kept);
   if not public.permission_allows_valid(keeps) then keeps:=null; end if;
   named:=btrim(case when btrim(kept->>'description',E' \t\r\n')<>'' then kept->>'description' else kept->>'command' end,E' \t\r\n');
   insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at,allows)
    values(talk.company_id,conversation,run,asked,'permission',
     case when length(named)<=100 then named else rtrim(left(named,99),E' \t\r\n')||'…' end,kept,'open',greatest(read_started_at,coalesce(read_ended_at,read_started_at)),keeps)
    on conflict do nothing;
  end if;
 end if;
 -- Each claimed choice is handed to this closer alone, for 15 seconds (a choice's call to the Engine gives up after 10):
 -- another closer's read meanwhile gets nothing to deliver, so the Engine is asked once; a closer that died or could not
 -- reach the Engine leaves it to the first read after that.
 with given as (
  update public.reply_cards r set delivering_at=now()
   where r.conversation_id=conversation and r.run_id=run and r.kind='permission' and r.state='sending'
    and (r.delivering_at is null or r.delivering_at<now()-interval '15 seconds')
    and not (r.content->>'choice'='always' and public.permission_revoke_held(talk.agent_id))
   returning r.id,r.call_id,r.content)
 select jsonb_agg(jsonb_build_object('card',g.id,'permission',g.call_id,'choice',g.content->'choice') order by g.id) into handed from given g;
 return coalesce(handed,'[]'::jsonb);
end $$;
revoke all on function public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text) to service_role;

-- 20270325000000's track_channel_permission, keeping the request's `allows` and holding an Always allow the same way.
create or replace function public.track_channel_permission(message bigint, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz default null, run_profile text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare called public.channel_runs; asked text:=asking->>'id'; own boolean; kept jsonb; named text; handed jsonb; keeps text[];
begin
 perform pg_advisory_xact_lock(hashtextextended('channel_permission:'||message::text,0));
 select * into called from public.channel_runs where message_id=message and run_id=run;
 if not found then return '[]'::jsonb; end if;
 update public.channel_permissions p set state='closed' where p.message_id=message and p.run_id=run
  and ((ended or called.outcome is not null) and p.state in ('open','sending') or p.state='open' and p.request_id is distinct from asked and p.created_at<read_started_at);
 if asked is not null and not ended and called.outcome is null then
  own:=coalesce(run_profile=public.agent_engine_profile(called.agent_id),false);
  kept:=jsonb_build_object('description',asking->'description','command',asking->'command','choices',
   case when jsonb_typeof(asking->'choices')='array' then coalesce((select jsonb_agg(o order by n) from jsonb_array_elements(asking->'choices') with ordinality x(o,n)
    where own or o<>'"always"'::jsonb),'[]'::jsonb) else asking->'choices' end);
  if length(asked) between 1 and 200 and public.reply_card_valid('permission','open',kept) then
   keeps:=public.permission_allows_of(asking,kept);
   if not public.permission_allows_valid(keeps) then keeps:=null; end if;
   named:=btrim(case when btrim(kept->>'description',E' \t\r\n')<>'' then kept->>'description' else kept->>'command' end,E' \t\r\n');
   insert into public.channel_permissions(company_id,channel_id,message_id,run_id,ordinal,request_id,title,content,state,created_at,allows)
    values(called.company_id,called.channel_id,message,run,called.ordinal,asked,
     case when length(named)<=100 then named else rtrim(left(named,99),E' \t\r\n')||'…' end,kept,'open',greatest(read_started_at,coalesce(read_ended_at,read_started_at)),keeps)
    on conflict do nothing;
  end if;
 end if;
 -- One closer at a time, as in a Conversation.
 with given as (
  update public.channel_permissions p set delivering_at=now()
   where p.message_id=message and p.run_id=run and p.state='sending'
    and (p.delivering_at is null or p.delivering_at<now()-interval '15 seconds')
    and not (p.content->>'choice'='always' and public.permission_revoke_held(called.agent_id))
   returning p.id,p.request_id,p.content)
 select jsonb_agg(jsonb_build_object('card',g.id,'permission',g.request_id,'choice',g.content->'choice') order by g.id) into handed from given g;
 return coalesce(handed,'[]'::jsonb);
end $$;
revoke all on function public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text) to service_role;

-- Who allowed each entry the Agent's always answers keep, and when: the latest always answer the Engine took for it, in
-- a Conversation or a channel of this Agent, in this Company, made after the entry's last revoke on this Agent (a grant
-- that was revoked never names the person behind an entry that came back another way). A reader who does not see the
-- Agent gets nothing, and an Agent of another Company is not found. The entries the Engine still holds are the driver's
-- to read; this only names the person behind each one.
create function public.agent_permission_grants(c uuid, agent uuid) returns table(entry text, allowed_by text, allowed_at timestamptz)
language sql stable security definer set search_path='' as $$
 select distinct on (g.entry) g.entry,p.name,g.at from (
  select a entry,r.decided_by who,r.decided_at at from public.reply_cards r join public.conversations v on v.id=r.conversation_id and v.company_id=r.company_id
   cross join unnest(r.allows) a
   where r.company_id=c and v.agent_id=agent and r.kind='permission' and r.state='decided' and r.content->>'choice'='always'
  union all
  select a,q.decided_by,q.decided_at from public.channel_permissions q join public.channel_runs u on u.message_id=q.message_id and u.run_id=q.run_id
   cross join unnest(q.allows) a
   where q.company_id=c and u.agent_id=agent and q.state='decided' and q.content->>'choice'='always'
 ) g join public.people p on p.id=g.who
 where not exists(select 1 from public.agent_permission_revoked x where x.agent_id=agent and x.company_id=c and x.entry=g.entry and x.revoked_at>=g.at)
  and public.is_member(c) and public.can_see_agent(c,agent) and exists(select 1 from public.hermes_agents h where h.id=agent and h.company_id=c)
 order by g.entry,g.at desc;
$$;
revoke all on function public.agent_permission_grants(uuid,uuid) from public,anon,service_role;
grant execute on function public.agent_permission_grants(uuid,uuid) to authenticated;

-- Only an active Owner or Manager who sees the Agent may revoke one of its standing permissions. The app asks before
-- the Engine is written, and the log asks again.
create function public.check_permission_revoke(c uuid, agent uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_manage_company(c) or not public.can_see_agent(c,agent) or not exists(select 1 from public.hermes_agents h where h.id=agent and h.company_id=c)
  then raise exception 'permissionNotAllowed' using errcode='42501'; end if;
end $$;
revoke all on function public.check_permission_revoke(uuid,uuid) from public,anon,service_role;
grant execute on function public.check_permission_revoke(uuid,uuid) to authenticated;

-- Takes the Agent's hold for a revoke by someone who may revoke: true when taken, false while another revoke holds it.
create function public.begin_permission_revoke(c uuid, agent uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare taken boolean;
begin
 perform public.check_permission_revoke(c,agent);
 insert into public.agent_permission_revokes as h(agent_id,company_id,held_by,held_until) values(agent,c,auth.uid(),now()+interval '60 seconds')
  on conflict (agent_id) do update set company_id=excluded.company_id,held_by=excluded.held_by,held_until=excluded.held_until where h.held_until<=now()
  returning true into taken;
 return coalesce(taken,false);
end $$;
revoke all on function public.begin_permission_revoke(uuid,uuid) from public,anon,service_role;
grant execute on function public.begin_permission_revoke(uuid,uuid) to authenticated;

-- Ends the caller's own hold on the Agent; any other hold is left as it is.
create function public.end_permission_revoke(c uuid, agent uuid) returns void
language sql security definer set search_path='' as $$
 delete from public.agent_permission_revokes where agent_id=agent and company_id=c and held_by=auth.uid();
$$;
revoke all on function public.end_permission_revoke(uuid,uuid) from public,anon,service_role;
grant execute on function public.end_permission_revoke(uuid,uuid) to authenticated;

-- The entries an Always allow may be adding to the Agent's profile right now: an always answer of a Conversation or a
-- channel of this Agent that is being delivered (sending), or that the Engine took in the last five minutes, unless it
-- was revoked since. The Engine's config route has no versioned write and shares no lock with its own save of an always
-- answer (tools/approval.py save_permanent_allowlist), so a revoke writes these back with the list it keeps: a grant
-- that lands while it writes is never dropped. Only someone who may revoke reads it.
create function public.agent_permission_inflight(c uuid, agent uuid) returns setof text
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.check_permission_revoke(c,agent);
 return query select distinct g.entry from (
  select a entry,coalesce(r.decided_at,now()) at from public.reply_cards r join public.conversations v on v.id=r.conversation_id and v.company_id=r.company_id
   cross join unnest(r.allows) a
   where r.company_id=c and v.agent_id=agent and r.kind='permission' and r.content->>'choice'='always'
    and (r.state='sending' or r.state='decided' and r.decided_at>now()-interval '5 minutes')
  union all
  select a,coalesce(q.decided_at,now()) from public.channel_permissions q join public.channel_runs u on u.message_id=q.message_id and u.run_id=q.run_id
   cross join unnest(q.allows) a
   where q.company_id=c and u.agent_id=agent and q.content->>'choice'='always'
    and (q.state='sending' or q.state='decided' and q.decided_at>now()-interval '5 minutes')
 ) g
 where not exists(select 1 from public.agent_permission_revoked x where x.agent_id=agent and x.company_id=c and x.entry=g.entry and x.revoked_at>=g.at);
end $$;
revoke all on function public.agent_permission_inflight(uuid,uuid) from public,anon,service_role;
grant execute on function public.agent_permission_inflight(uuid,uuid) to authenticated;

-- The entries of the Agent's always answers still being delivered (claimed, not yet settled): one may already be on its
-- way to the Engine, handed to a closer before a revoke's hold. A revoke of such an entry waits for it to settle, and
-- reports busy rather than success while it has not, so a successful revoke is never undone by an earlier answer.
create function public.agent_permission_sending(c uuid, agent uuid) returns setof text
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.check_permission_revoke(c,agent);
 return query select distinct a from public.reply_cards r join public.conversations v on v.id=r.conversation_id and v.company_id=r.company_id
   cross join unnest(r.allows) a
   where r.company_id=c and v.agent_id=agent and r.kind='permission' and r.state='sending' and r.content->>'choice'='always'
  union
  select distinct a from public.channel_permissions q join public.channel_runs u on u.message_id=q.message_id and u.run_id=q.run_id
   cross join unnest(q.allows) a
   where q.company_id=c and u.agent_id=agent and q.state='sending' and q.content->>'choice'='always';
end $$;
revoke all on function public.agent_permission_sending(uuid,uuid) from public,anon,service_role;
grant execute on function public.agent_permission_sending(uuid,uuid) to authenticated;

-- Keeps that `entry` is being taken out of the Agent's profile, by someone who may revoke, before the Engine is written:
-- a revoke whose record cannot be kept changes nothing. It answers the record's time, so a revoke the Engine then does
-- not take withdraws that one record (forget_permission_revoked) and an older grant names its person again.
create function public.note_permission_revoked(c uuid, agent uuid, entry text) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare kept timestamptz:=clock_timestamp();
begin
 perform public.check_permission_revoke(c,agent);
 if entry is null or length(entry) not between 1 and 1000 then raise exception 'permissionInvalid' using errcode='22023'; end if;
 insert into public.agent_permission_revoked(agent_id,company_id,entry,revoked_at) values(agent,c,note_permission_revoked.entry,kept)
  on conflict on constraint agent_permission_revoked_pkey do update set company_id=excluded.company_id,revoked_at=excluded.revoked_at,previous_at=public.agent_permission_revoked.revoked_at;
 return kept;
end $$;
revoke all on function public.note_permission_revoked(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.note_permission_revoked(uuid,uuid,text) to authenticated;

-- Withdraws the record a revoke kept when the Engine did not take the revoke, putting back the record it replaced if
-- there was one; a later revoke's record is left alone.
create function public.forget_permission_revoked(c uuid, agent uuid, entry text, kept timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_permission_revoke(c,agent);
 -- An earlier revoke's record comes back (a retry of a revoke that already succeeded keeps its exclusion); with none,
 -- the record goes.
 update public.agent_permission_revoked x set revoked_at=x.previous_at,previous_at=null
  where x.agent_id=agent and x.company_id=c and x.entry=forget_permission_revoked.entry and x.revoked_at=kept and x.previous_at is not null;
 delete from public.agent_permission_revoked x where x.agent_id=agent and x.company_id=c and x.entry=forget_permission_revoked.entry and x.revoked_at=kept and x.previous_at is null;
end $$;
revoke all on function public.forget_permission_revoked(uuid,uuid,text,timestamptz) from public,anon,service_role;
grant execute on function public.forget_permission_revoked(uuid,uuid,text,timestamptz) to authenticated;

-- A revoke the Engine confirmed, as one row on the Agent (design-reference: the click case revoke): who, the Agent, the
-- permission as its row names it (`text`) and the entry as the Engine kept it (`entry`, so an older grant of it no longer
-- names anyone), from "Standing" to "Will ask again". It is read by everyone who sees the Agent, as the row it removes was.
create function public.log_permission_revoked(c uuid, agent uuid, permission text, entry text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_permission_revoke(c,agent);
 if permission is null or length(permission) not between 1 and 300 or btrim(permission,E' \t\r\n')=''
  or entry is null or length(entry) not between 1 and 1000 then raise exception 'permissionInvalid' using errcode='22023'; end if;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),'agent',agent,'agent_permission_revoked',
   jsonb_build_object('agent_name',(select name from public.hermes_agents where id=agent),'permission',jsonb_build_object('text',permission,'entry',entry)),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
end $$;
revoke all on function public.log_permission_revoked(uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.log_permission_revoked(uuid,uuid,text,text) to authenticated;
