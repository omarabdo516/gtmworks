-- #152: a channel message that calls two or three Agents gets a reply from each, in the order they were named, one Run
-- after another. A fourth Agent named in the same message does not answer, a name repeated calls its Agent once, and
-- ordinary talk still calls nobody. The rules of one name stay #23's: "@" and the name between spaces, punctuation or
-- the ends, only an Agent the sender may call there (#15, #24), the longest name at one place, and for the same name the
-- main Agent.
--
-- Additive only, widening what #23 built: channel_runs keeps one row per (message, Agent) instead of one per message,
-- and a reply keeps one row per (message, Agent) instead of one per message. Each Agent's Run is started in the order
-- named, and the next only once the one before it has ended, whatever its outcome. Every function #148 and #165 added is
-- redefined from its latest definition, per Run. No stored row loses anything: the new columns answer the one Run and one
-- reply each message had, so every message and Run reads as before, the previous app version runs against this (it drives
-- the first Agent of a message; the second answers under this version), and no existing test loses a case.

-- Two or three Agents per message: `ordinal` is the place the Agent was named in, 1 to 3. The pair is the Run's key, so a
-- message and an Agent keep one Run; agent_id stays nullable (a removed Agent leaves its replies).
alter table public.channel_runs add column ordinal smallint not null default 1 check (ordinal between 1 and 3);
-- A request holds its Run by the engine run id from now on, so the link to the message goes first and the wider key
-- (a message and a place) can take the one message_id alone had.
alter table public.channel_permissions drop constraint channel_permissions_message_id_fkey;
alter table public.channel_runs drop constraint channel_runs_pkey;
alter table public.channel_runs add primary key (message_id, ordinal);
create unique index channel_runs_one_agent on public.channel_runs(message_id, agent_id) where agent_id is not null;

-- A reply names the place of the Run that wrote it, so a message keeps one reply per Agent. A reply stored before this
-- migration has no place and is still the one reply its message had.
alter table public.channel_messages add column reply_ordinal smallint check (reply_ordinal between 1 and 3);
alter table public.channel_messages drop constraint channel_messages_reply_to_key;
create unique index channel_messages_one_reply on public.channel_messages(reply_to, reply_ordinal);

-- A request belongs to one Run, not to its message: the engine run id is the link (it is already unique on the Run), and
-- `ordinal` names the Agent whose turn it is drawn under, which every member of the channel reads.
alter table public.channel_permissions add column ordinal smallint;
update public.channel_permissions set ordinal=1 where ordinal is null;
alter table public.channel_permissions add constraint channel_permissions_run_fkey foreign key (run_id) references public.channel_runs(run_id);
alter table public.channel_permissions add constraint channel_permissions_ordinal check (ordinal is null or ordinal between 1 and 3);
alter table public.channel_permissions drop constraint channel_permissions_message_id_request_id_key;
alter table public.channel_permissions add constraint channel_permissions_run_request unique (run_id, request_id);

-- The Agents a message calls, up to three, each once, in the order they were named: the text is read from the start,
-- each "@" between spaces, punctuation or the ends is a call, and at one place the longest name that fits there is the
-- one called. A shorter name covered at one place is still called where it stands on its own, and the same Agent named
-- twice is called once. A Member's name is no Agent's name: it calls nobody.
create function public.channel_mentions(c uuid, person uuid, message text) returns table(agent uuid, ordinal smallint)
language plpgsql stable security definer set search_path='' as $$
declare a record; body text := coalesce(message,''); at int; from_at int := 1; taken uuid[] := '{}'; called int := 0;
begin
 while from_at <= length(body) loop
  at := position('@' in substr(body, from_at)); exit when at = 0; at := at + from_at - 1;
  if not (at = 1 or substr(body, at-1, 1) ~ '[[:space:][:punct:]،؛؟]') then from_at := at + 1; continue; end if;
  select x.id, x.handle into a from (
    select h.id, h.is_default, lower('@'||btrim(h.name)) handle from public.hermes_agents h
    where h.company_id=c and btrim(h.name)<>'' and public.agent_visible_to(c, person, h.id)) x
   where strpos(lower(substr(body, at)), x.handle) = 1
    and (at + length(x.handle) > length(body) or substr(body, at + length(x.handle), 1) ~ '[[:space:][:punct:]،؛؟]')
   order by length(x.handle) desc, x.is_default desc, x.id limit 1;
  if a.id is null then from_at := at + 1; continue; end if;
  from_at := at + length(a.handle);
  continue when a.id = any(taken);
  taken := taken || a.id; called := called + 1;
  agent := a.id; ordinal := called::smallint; return next;
  exit when called = 3;
 end loop;
end $$;
revoke all on function public.channel_mentions(uuid,uuid,text) from public,anon,authenticated,service_role;

-- The same, among the Agents callable in one channel (#24): the general channel's are the ones the sender sees anywhere,
-- a team channel's are its own. A team channel's Agent hidden from the sender elsewhere is called here, as before.
create function public.channel_mentions_in(ch uuid, person uuid, message text) returns table(agent uuid, ordinal smallint)
language plpgsql stable security definer set search_path='' as $$
declare a record; body text := coalesce(message,''); at int; from_at int := 1; taken uuid[] := '{}'; called int := 0;
begin
 while from_at <= length(body) loop
  at := position('@' in substr(body, from_at)); exit when at = 0; at := at + from_at - 1;
  if not (at = 1 or substr(body, at-1, 1) ~ '[[:space:][:punct:]،؛؟]') then from_at := at + 1; continue; end if;
  select x.id, x.handle into a from (
    select h.id, h.is_default, lower('@'||btrim(h.name)) handle
    from public.channels k join public.hermes_agents h on h.company_id=k.company_id
    where k.id=ch and btrim(h.name)<>'' and public.channel_agent(ch, person, h.id)) x
   where strpos(lower(substr(body, at)), x.handle) = 1
    and (at + length(x.handle) > length(body) or substr(body, at + length(x.handle), 1) ~ '[[:space:][:punct:]،؛؟]')
   order by length(x.handle) desc, x.is_default desc, x.id limit 1;
  if a.id is null then from_at := at + 1; continue; end if;
  from_at := at + length(a.handle);
  continue when a.id = any(taken);
  taken := taken || a.id; called := called + 1;
  agent := a.id; ordinal := called::smallint; return next;
  exit when called = 3;
 end loop;
end $$;
revoke all on function public.channel_mentions_in(uuid,uuid,text) from public,anon,authenticated,service_role;

-- #23's and #24's one-Agent answers, now the first of the calls above: the earliest, longest name. Kept for callers that
-- ask which one Agent a message calls.
create or replace function public.channel_mention(c uuid, person uuid, message text) returns uuid
language sql stable security definer set search_path='' as $$
 select m.agent from public.channel_mentions(c, person, message) m order by m.ordinal limit 1;
$$;
revoke all on function public.channel_mention(uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function public.channel_mention_in(ch uuid, person uuid, message text) returns uuid
language sql stable security definer set search_path='' as $$
 select m.agent from public.channel_mentions_in(ch, person, message) m order by m.ordinal limit 1;
$$;
revoke all on function public.channel_mention_in(uuid,uuid,text) from public,anon,authenticated,service_role;

-- 20261227000000's post_channel_message; a message now starts one Run per Agent it calls, in the order named, each with
-- the same message and the Agent's own session, instructions and rules.
create or replace function public.post_channel_message(ch uuid, message_key uuid, message text) returns bigint
language plpgsql security definer set search_path='' as $$
declare k public.channels; saved bigint; writer text; chosen record;
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
 for chosen in select h.*, m.ordinal from public.channel_mentions_in(ch, auth.uid(), message) m
  join public.hermes_agents h on h.id=m.agent order by m.ordinal loop
  insert into public.channel_runs(message_id, ordinal, company_id, channel_id, agent_id, agent_name, session, input, instructions, rules)
   values (saved, chosen.ordinal, k.company_id, ch, chosen.id, chosen.name, md5(ch::text||':'||chosen.id::text)::uuid,
           split_part(coalesce(writer,''),' ',1)||': '||message, nullif(btrim(chosen.instructions),''), public.agent_rules_in_force(chosen.id));
 end loop;
 return saved;
end $$;
revoke all on function public.post_channel_message(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.post_channel_message(uuid,uuid,text) to authenticated;

-- 20270213000000's channel_runs_due, now one row per Run: a Run is due only when no earlier Run of its message is still
-- open, so the Agents answer one after another. A Run after the first is due as soon as the one before it ended (its
-- sender's request ended with that Run), and a page of 500 still runs after the message `after`.
drop function public.channel_runs_due(uuid,bigint,bigint);
create function public.channel_runs_due(just_channel uuid default null, just_message bigint default null, after bigint default 0)
 returns table(message bigint, run text, profile text, ordinal smallint)
 language sql stable security definer set search_path='' as $function$
 select r.message_id, r.run_id, r.profile, r.ordinal from public.channel_runs r
 where r.outcome is null and r.message_id > coalesce(after, 0)
  and (just_channel is null or r.channel_id=just_channel) and (just_message is null or r.message_id=just_message)
  and (r.run_id is not null or r.message_id=just_message or r.ordinal > 1
   or (r.attempts = 0 and r.created_at < now()-interval '1 minute') or (r.attempts > 0 and r.attempted_at < now()-interval '30 seconds'))
  and not exists(select 1 from public.channel_runs e where e.message_id=r.message_id and e.ordinal<r.ordinal and e.outcome is null)
 order by r.message_id, r.ordinal limit 500;
$function$;
revoke all on function public.channel_runs_due(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.channel_runs_due(uuid,bigint,bigint) to service_role;

-- 20270213000000's begin_channel_start, on the first Run of the message still open: the Run the caller was given. It
-- answers the place of that Run too, so the caller's idempotency key names the Run it really began, not one that closed
-- between the read and this call. The lock a profile move takes is still taken first, so no move passes between pinning a
-- profile and the move's check.
drop function public.begin_channel_start(bigint);
create function public.begin_channel_start(message bigint)
 returns table(attempt integer, company uuid, profile text, session uuid, input text, instructions text, rules text[], ordinal smallint)
 language plpgsql security definer set search_path='' as $function$
declare r public.channel_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.channel_runs where message_id=message and outcome is null order by ordinal limit 1 for update;
 if r.message_id is null or r.outcome is not null or r.run_id is not null then return; end if;
 -- Never started: given up after ten minutes. May have started: given up after a day, as ADR 0015 gives up a start
 -- whose answer was lost.
 if r.attempts = 0 and r.created_at < now()-interval '10 minutes' then perform public.close_channel_run(message,null,'failed',null,null,null); return; end if;
 if r.attempts > 0 and r.created_at < now()-interval '1 day' then perform public.close_channel_run(message,null,'lost',null,null,null); return; end if;
 if r.attempts = 0 then
  select a.connection_id,a.profile into r.connection_id,r.profile from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id;
  if r.profile is null then perform public.close_channel_run(message,null,'failed',null,null,null); return; end if;
 elsif r.profile is null then
  perform public.close_channel_run(message,null,'lost',null,null,null); return;
 end if;
 -- ADR 0014: a Company profile serves its own Company, and no Run starts while its tools are pending. Waiting returns
 -- nothing; the deadlines above end the wait.
 if r.profile ~ '^co-[0-9a-f]{32}$' and (r.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 -- ADR 0016: an Agent profile serves its own Agent, on the same terms.
 if public.agent_profile_refusal(r.profile,r.company_id,r.agent_id) is not null then return; end if;
 update public.channel_runs set attempts=attempts+1, attempted_at=now(), connection_id=r.connection_id, profile=r.profile
  where message_id=message and public.channel_runs.ordinal=r.ordinal returning attempts into r.attempts;
 return query select r.attempts, r.company_id, r.profile, r.session, r.input, r.instructions, r.rules, r.ordinal;
end $function$;
revoke all on function public.begin_channel_start(bigint) from public,anon,authenticated;
grant execute on function public.begin_channel_start(bigint) to service_role;

-- 20261219000000's answer_channel_start, on the Run the engine answered for. A run id already recorded on another Run of
-- the same message is not this Run's: only a row without one takes it.
create or replace function public.answer_channel_start(message bigint, attempt integer, run text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs;
begin
 if run is not null then
  select * into r from public.channel_runs where message_id=message and run_id=run for update;
  if found then return r.outcome is null; end if;
 end if;
 select * into r from public.channel_runs where message_id=message and outcome is null and run_id is null order by ordinal limit 1 for update;
 if r.message_id is null or r.outcome is not null then return false; end if;
 if run is not null then
  update public.channel_runs set run_id=run where message_id=message and ordinal=r.ordinal; return true;
 end if;
 -- A refused first start ends the Run only while no later attempt was made: only a first start can prove nothing started.
 if attempt = 1 and r.attempts = 1 then
  return public.close_channel_run(message, null, 'failed', null, null, null);
 end if;
 return false;
end $$;

-- 20270212000000's close_channel_run, on one Run of the message: the one its engine run id names, or the first still
-- open (a start given up before it named one). Its reply carries the place of that Run.
create or replace function public.close_channel_run(message bigint, run text, run_outcome text, reply text, used_input bigint, used_output bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.channel_runs;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(reply),'') <> '') then
  raise exception 'channelFailed' using errcode='22023'; end if;
 if run is null then
  select * into r from public.channel_runs where message_id=message and outcome is null order by ordinal limit 1 for update;
 else
  select * into r from public.channel_runs where message_id=message and outcome is null and run_id=run for update;
 end if;
 if r.message_id is null then return false; end if;
 update public.channel_runs set outcome=run_outcome, closed_at=now()
  where message_id=message and ordinal=r.ordinal;
 if run_outcome='completed' then
  insert into public.channel_messages(company_id, channel_id, author, agent_id, author_name, body, reply_to, reply_ordinal)
   values (r.company_id, r.channel_id, 'agent', r.agent_id, r.agent_name, left(reply, 200000), message, r.ordinal)
   on conflict (reply_to, reply_ordinal) do nothing;
 end if;
 return true;
end $$;

revoke all on function public.answer_channel_start(bigint,integer,text) from public,anon,authenticated;
revoke all on function public.close_channel_run(bigint,text,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.answer_channel_start(bigint,integer,text), public.close_channel_run(bigint,text,text,text,bigint,bigint) to service_role;

-- #148's pin_channel_run, on the first Run of the message still open, which is the Run being started: the draft and
-- review tools when the Member who called its Agent may write.
create or replace function public.pin_channel_run(message bigint, specs jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs; m public.channel_messages; offered text[];
begin
 select * into r from public.channel_runs where message_id=message and outcome is null order by ordinal limit 1 for update;
 if r.message_id is null or r.outcome is not null then return null; end if;
 if r.tools is null then
  select * into m from public.channel_messages where id=message;
  if m.id is null or m.author<>'person' then return null; end if;
  if public.channel_can_show_cards(r.channel_id,m.person_id,r.agent_id) then
   offered:=array(select t from unnest(array['show_draft','show_review']) t where jsonb_typeof(specs->t)='string');
   update public.channel_runs set tools=case when cardinality(offered)>0 then
     '['||(select string_agg(specs->>t,',' order by o) from unnest(offered) with ordinality u(t,o))||']' end
    where message_id=message and ordinal=r.ordinal returning * into r;
  end if;
 end if;
 return jsonb_build_object('tools',r.tools);
end $$;
revoke all on function public.pin_channel_run(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.pin_channel_run(bigint,jsonb) to service_role;

-- #148's channel_show_card, on the Run its engine run id names: the same message, run and call again answer the card it
-- showed, and the card links to the channel message whose Run carries it.
create or replace function public.channel_show_card(message bigint, run text, call text, kind text, title text, content jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs; m public.channel_messages; kept public.reply_cards;
begin
 select * into kept from public.reply_cards c where c.channel_message_id=message and c.run_id=run and c.call_id=call;
 if found then return jsonb_build_object('state','shown','card',kept.id); end if;
 select * into r from public.channel_runs where message_id=message and run_id=run;
 select * into m from public.channel_messages where id=message;
 if r.message_id is null or m.id is null or m.author<>'person' or r.run_id is distinct from run
  or kind not in ('draft','review')
  or not public.channel_can_show_cards(r.channel_id,m.person_id,r.agent_id) then return jsonb_build_object('state','refused'); end if;
 if not (public.reply_card_text(to_jsonb(title),100) and public.reply_card_valid(kind,'shown',content)) then
  return jsonb_build_object('state','invalid'); end if;
 insert into public.reply_cards(company_id,channel_message_id,run_id,call_id,kind,title,content,state)
  values(r.company_id,message,run,call,kind,title,content,'shown')
  on conflict (channel_message_id,run_id,call_id) do nothing returning * into kept;
 if kept.id is null then
  select * into kept from public.reply_cards c where c.channel_message_id=message and c.run_id=run and c.call_id=call;
 else
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
   values(r.company_id,r.agent_id,'agent',(select name from public.hermes_agents where id=r.agent_id),'agent',r.agent_id,'agent_card_shown',
    jsonb_build_object('card',jsonb_build_object('kind',kept.kind,'title',kept.title)||case when kept.kind='review' then
      (select jsonb_build_object('fine',count(*) filter (where i->'fine'='true'::jsonb),'edits',count(*) filter (where i->'fine'='false'::jsonb))
       from jsonb_array_elements(kept.content->'items') i) else '{}'::jsonb end,
     'private',true,'teller',m.person_id),
    'reply_cards',kept.id,kept.created_at)
   on conflict (source,source_id) do nothing;
 end if;
 return jsonb_build_object('state','shown','card',kept.id);
end $$;
revoke all on function public.channel_show_card(bigint,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.channel_show_card(bigint,text,text,text,text,jsonb) to service_role;

-- #148's channel_run_sessions, now one row per Run with the reply it wrote: each Agent's reply reads the steps of its own
-- Run's session. A reply stored before this migration has no place and reads as the first Run's.
drop function public.channel_run_sessions(uuid,bigint);
create function public.channel_run_sessions(ch uuid, after bigint default 0)
returns table(message_id bigint, agent_id uuid, profile text, session uuid, reply bigint)
language sql stable security definer set search_path='' as $$
 select r.message_id,r.agent_id,r.profile,r.session,m.id from public.channel_runs r
  join public.channel_messages m on m.reply_to=r.message_id and coalesce(m.reply_ordinal,1)=r.ordinal and m.author='agent'
 where r.channel_id=ch and auth.uid() is not null and public.in_channel(ch) and r.message_id>coalesce(after,0)
  and r.outcome='completed' and r.agent_id is not null and r.profile is not null and r.session is not null;
$$;
revoke all on function public.channel_run_sessions(uuid,bigint) from public,anon,service_role;
grant execute on function public.channel_run_sessions(uuid,bigint) to authenticated;

-- 20270203000001's track_channel_permission, on one Run of the message: its request is closed and claimed by that Run
-- only, never by a sibling Agent's, and the row names the place of the Agent that asked.
create or replace function public.track_channel_permission(message bigint, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz default null, run_profile text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare called public.channel_runs; asked text:=asking->>'id'; own boolean; kept jsonb; named text; handed jsonb;
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
   named:=btrim(case when btrim(kept->>'description',E' \t\r\n')<>'' then kept->>'description' else kept->>'command' end,E' \t\r\n');
   insert into public.channel_permissions(company_id,channel_id,message_id,run_id,ordinal,request_id,title,content,state,created_at)
    values(called.company_id,called.channel_id,message,run,called.ordinal,asked,
     case when length(named)<=100 then named else rtrim(left(named,99),E' \t\r\n')||'…' end,kept,'open',greatest(read_started_at,coalesce(read_ended_at,read_started_at)))
    on conflict do nothing;
  end if;
 end if;
 -- One closer at a time, as in a Conversation.
 with given as (
  update public.channel_permissions p set delivering_at=now()
   where p.message_id=message and p.run_id=run and p.state='sending'
    and (p.delivering_at is null or p.delivering_at<now()-interval '15 seconds')
   returning p.id,p.request_id,p.content)
 select jsonb_agg(jsonb_build_object('card',g.id,'permission',g.request_id,'choice',g.content->'choice') order by g.id) into handed from given g;
 return coalesce(handed,'[]'::jsonb);
end $$;
revoke all on function public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text) to service_role;

-- 20270130000000's channel_permission_waits, linked to its Run by the engine run id.
create or replace function public.channel_permission_waits(request public.channel_permissions) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.channel_permissions p
  join public.channel_runs r on r.run_id=p.run_id and r.outcome is null
  join public.channel_messages m on m.id=p.message_id
  where p.id=request.id and p.state='open' and m.person_id=auth.uid() and public.conversation_can_write(p.company_id)
   and r.agent_id is not null and public.channel_agent(p.channel_id,auth.uid(),r.agent_id));
$$;
revoke all on function public.channel_permission_waits(public.channel_permissions) from public,anon,service_role;
grant execute on function public.channel_permission_waits(public.channel_permissions) to authenticated;

-- 20270130000000's decide_channel_permission, on the Run that asked.
create or replace function public.decide_channel_permission(c uuid, request bigint, choice text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare asked public.channel_permissions; called public.channel_runs; caller uuid;
begin
 select * into asked from public.channel_permissions p where p.id=request and p.company_id=c and public.in_channel(p.channel_id) for update;
 if not found then raise exception 'channelNotFound' using errcode='P0002'; end if;
 select * into called from public.channel_runs where run_id=asked.run_id;
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

-- 20270130000000's settle_channel_permission, naming the Agent of the Run that asked.
create or replace function public.settle_channel_permission(card bigint, verdict text) returns text
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
    (select r.agent_id from public.channel_runs r where r.run_id=asked.run_id),'agent_permission_decided',
    jsonb_build_object('permission',jsonb_build_object('text',case when btrim(asked.content->>'description',E' \t\r\n')<>'' then asked.content->'description' else asked.content->'command' end,
     'choice',asked.content->'choice'),'private',true,'teller',asked.decided_by),
    'channel_permissions',asked.id,asked.decided_at)
   on conflict (source,source_id) do nothing;
 end if;
 return verdict;
end $$;
revoke all on function public.settle_channel_permission(bigint,text) from public,anon,authenticated;
grant execute on function public.settle_channel_permission(bigint,text) to service_role;

-- 20270130000000's close_ended_channel_permissions: a Run's end closes its own requests, not a sibling Agent's.
create or replace function public.close_ended_channel_permissions() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('channel_permission:'||new.message_id::text,0));
 update public.channel_permissions set state='closed' where run_id=new.run_id and state in ('open','sending');
 return null;
end $$;
revoke all on function public.close_ended_channel_permissions() from public,anon,authenticated,service_role;

-- 20270130000000's waiting_list, its channel request linked to its Run through the message and the place, which a reader
-- may see: it runs as the caller, and the engine run id is the worker's alone.
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
   where p.company_id=c and p.state='open' and public.channel_permission_waits(p)
  union all
  select 'agent_key'::text, k.id, g.name, ''::text, ''::text, null::bigint, null::uuid, k.created_at
   from public.agent_key_waits k
   join public.hermes_agents g on g.company_id=k.company_id and g.id=k.agent_id
   where k.company_id=c and public.agent_key_waits_shown(c)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;

-- A reader sees how many Agents a message called and where each stands, never what a Run sent: the place is added to the
-- columns a signed-in Member reads, as the state is.
grant select (ordinal) on public.channel_runs to authenticated;
