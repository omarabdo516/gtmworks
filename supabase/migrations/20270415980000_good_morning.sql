-- #183: the morning message. The main Agent's daily job is #182's (one cron job of its own Engine profile; the Engine
-- holds its switch and time). Each run of it the worker reads back is one morning of the Company (good_mornings), with
-- the Routine results of the night before it (good_morning_results); a Member with anything in any part of the card gets
-- a new Conversation with the main Agent holding the run's reply (conversations.good_morning). The card itself is read
-- from gtmworks's records when the Conversation is read, so an item settled since leaves it. One run a Company a day,
-- never one per Member (Omar, 2026-11-18).

-- One run of the job, read back once: its Engine session, the day it greets (in the job's own zone), when it ran, and the
-- run's reply. A run that answered [SILENT] (the Engine's rule for "nothing new") keeps no greeting and makes no
-- Conversation; it is kept so the page can say why yesterday had no message, and so it is never read twice.
create table public.good_mornings (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id) on delete cascade,
 agent_id uuid references public.hermes_agents(id) on delete set null,
 session_id text not null check (session_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 day date not null,
 ran_at timestamptz not null,
 greeting text check (length(greeting) between 1 and 4000),
 created_at timestamptz not null default now(),
 unique(company_id,session_id),
 unique(id,company_id)
);
create index good_mornings_latest on public.good_mornings(company_id,ran_at desc);
alter table public.good_mornings enable row level security;
create policy good_mornings_read on public.good_mornings for select to authenticated using (public.is_member(company_id));
revoke all on public.good_mornings from anon,authenticated,service_role;
grant select on public.good_mornings to authenticated;

-- What ran overnight: each Routine result of an Agent of the Company between the morning before and this one. A Member
-- reads only the results of Agents they see (can_see_agent), so each card holds only what its reader may see.
create table public.good_morning_results (
 id bigint generated always as identity primary key,
 morning_id bigint not null,
 company_id uuid not null,
 agent_id uuid not null references public.hermes_agents(id) on delete cascade,
 routine text not null check (length(routine) between 1 and 200),
 line text not null check (length(line) between 1 and 300),
 ran_at timestamptz not null,
 foreign key (morning_id,company_id) references public.good_mornings(id,company_id) on delete cascade
);
create index good_morning_results_morning on public.good_morning_results(morning_id,ran_at desc);
alter table public.good_morning_results enable row level security;
create policy good_morning_results_read on public.good_morning_results for select to authenticated
 using (public.is_member(company_id) and public.can_see_agent(company_id,agent_id));
revoke all on public.good_morning_results from anon,authenticated,service_role;
grant select on public.good_morning_results to authenticated;

-- A Conversation the morning opened names its morning and the day it greets; its title is drawn from that day in the
-- reader's language.
alter table public.conversations add column good_morning bigint, add column good_morning_day date,
 add constraint conversations_good_morning_fk foreign key (good_morning,company_id) references public.good_mornings(id,company_id) on delete set null (good_morning),
 add constraint conversations_good_morning_day check ((good_morning is null) or (good_morning_day is not null));
create unique index conversations_one_good_morning on public.conversations(good_morning,person_id) where good_morning is not null;

-- The worker's list: each Company's main Agent on a profile of its own, where #182 keeps the daily job (found there by
-- its marker, lib/morning-schedule.mjs), and when the Company's latest message was sent (a [SILENT] morning sent none),
-- which is where the next one's night starts.
create function public.good_morning_work() returns table(company_id uuid, agent_id uuid, profile text, last_ran_at timestamptz)
language sql stable security definer set search_path='' as $$
 select a.company_id,a.id,a.profile,
  (select max(g.ran_at) from public.good_mornings g where g.company_id=a.company_id and g.greeting is not null)
 from public.hermes_agents a where a.is_default and a.profile ~ '^(co|ag)-[0-9a-f]{32}$'
 order by a.company_id;
$$;
revoke all on function public.good_morning_work() from public,anon,authenticated;
grant execute on function public.good_morning_work() to service_role;

-- The Agents whose Routines the night is read from: every Agent of the Company on a profile of its own Engine, the main
-- Agent first.
create function public.good_morning_agents(c uuid) returns table(id uuid, profile text, is_default boolean, name text)
language sql stable security definer set search_path='' as $$
 select a.id,a.profile,a.is_default,a.name from public.hermes_agents a
 where a.company_id=c and a.profile ~ '^(co|ag)-[0-9a-f]{32}$' order by a.is_default desc,a.name,a.id;
$$;
revoke all on function public.good_morning_agents(uuid) from public,anon,authenticated;
grant execute on function public.good_morning_agents(uuid) to service_role;

-- The sessions of a job's runs already read, so the worker reads each run once.
create function public.good_morning_seen(c uuid, sessions text[]) returns setof text
language sql stable security definer set search_path='' as $$
 select g.session_id from public.good_mornings g where g.company_id=c and g.session_id=any(sessions);
$$;
revoke all on function public.good_morning_seen(uuid,text[]) from public,anon,authenticated;
grant execute on function public.good_morning_seen(uuid,text[]) to service_role;

-- One run of the job, recorded once (the worker alone writes it, so nobody puts words in the main Agent's mouth). With a
-- greeting, each active Member who has anything in a part of the card gets a new Conversation with the Agent holding it:
-- an item of their own "Waiting on you" (waiting_list, read as that Member) or a result of an Agent they see. A run
-- with no greeting makes none. Answers how many Conversations it opened, or null when the run
-- was recorded already.
-- Whether anything waits on the signed-in Member in their own "Waiting on you". It runs as the authenticated role, not as
-- its definer, so every row-level policy of that read applies exactly as in the Member's own session (a mention in a
-- channel they left, an item on a Card or a Conversation of an Agent hidden from them); record_good_morning, which reads
-- past those policies, asks it for each Member as that Member. Nobody calls it directly.
create function public.good_morning_waits(c uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.waiting_list(c) x
  where (x.card_id is null or public.can_see_card(c,x.card_id))
   and (x.kind<>'approval' or not exists(select 1 from public.work_cards w where w.company_id=c and w.id=x.id
    and w.agent_id is not null and not public.can_see_agent(c,w.agent_id))));
$$;
-- Owning it needs CREATE on the schema at that moment only: granted for the change and taken back, so the role keeps no
-- new right.
grant create on schema public to authenticated;
alter function public.good_morning_waits(uuid) owner to authenticated;
revoke create on schema public from authenticated;
revoke all on function public.good_morning_waits(uuid) from public,anon,authenticated,service_role;
-- record_good_morning runs as its owner, postgres, and is its one caller.
grant execute on function public.good_morning_waits(uuid) to postgres;

create function public.record_good_morning(c uuid, agent uuid, session text, greeting_day date, ran timestamptz, greeting text, results jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare morning bigint; main public.hermes_agents; member record; opened integer:=0; talk uuid; reader text;
begin
 select * into main from public.hermes_agents a where a.id=agent and a.company_id=c;
 if not found then raise exception 'goodMorningInvalid' using errcode='22023'; end if;
 if results is null or jsonb_typeof(results)<>'array' or jsonb_array_length(results)>200 then raise exception 'goodMorningInvalid' using errcode='22023'; end if;
 insert into public.good_mornings(company_id,agent_id,session_id,day,ran_at,greeting) values(c,agent,session,greeting_day,ran,nullif(left(trim(greeting),4000),''))
  on conflict (company_id,session_id) do nothing returning id into morning;
 if morning is null then return null; end if;
 insert into public.good_morning_results(morning_id,company_id,agent_id,routine,line,ran_at)
  select morning,c,(r->>'agent')::uuid,left(r->>'routine',200),left(r->>'line',300),(r->>'at')::timestamptz
  from jsonb_array_elements(results) r
  where exists(select 1 from public.hermes_agents a where a.id=(r->>'agent')::uuid and a.company_id=c)
   and coalesce(r->>'routine','')<>'' and coalesce(r->>'line','')<>'';
 if nullif(trim(coalesce(greeting,'')),'') is null then return 0; end if;
 reader:=current_setting('request.jwt.claim.sub',true);
 for member in select m.person_id from public.members m where m.company_id=c and m.removed_at is null order by m.person_id loop
  -- Each Member's parts are read as that Member, with the very reads their own card makes.
  perform set_config('request.jwt.claim.sub',member.person_id::text,true);
  -- What the Member's own card would show: their "Waiting on you" under their own policies, or a result of the night
  -- from an Agent they see.
  if public.good_morning_waits(c)
   or exists(select 1 from public.good_morning_results r where r.morning_id=morning and public.can_see_agent(c,r.agent_id)) then
   talk:=gen_random_uuid();
   insert into public.conversations(id,company_id,person_id,agent_id,agent_name,good_morning,good_morning_day)
    values(talk,c,member.person_id,main.id,main.name,morning,greeting_day);
   insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id,created_at)
    values(c,talk,'agent',main.id,main.name,left(trim(greeting),4000),'good-morning:'||morning,ran);
   opened:=opened+1;
  end if;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(reader,''),true);
 return opened;
end $$;
revoke all on function public.record_good_morning(uuid,uuid,text,date,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_good_morning(uuid,uuid,text,date,timestamptz,text,jsonb) to service_role;

-- A Member's first reply in a morning Conversation starts a new Engine session, which never held the greeting: the run
-- of the daily job wrote it in its own cron session. So that first Run carries the Conversation's messages so far (the
-- greeting) as its history, as a Conversation from before an Agent's profile move does (20270213000000), pinned so a
-- retry sends the same. Every other Run is as before.
create or replace function public.pin_run_history(conversation uuid, message_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare held public.conversation_run_reservations; kept public.conversation_run_notes; moved_at timestamptz; record jsonb; morning boolean;
begin
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key for update;
 select * into kept from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if kept.conversation_id is null then return null; end if;
 if kept.history is null and held.conversation_id is not null and held.start_attempts=0 and held.start_unknown_at is null then
  select v.good_morning is not null and v.hermes_session_id is null into morning from public.conversations v where v.id=conversation;
  if held.profile=public.agent_engine_profile(held.agent_id) then
   select max(l.created_at) into moved_at from public.company_log l where l.agent_id=held.agent_id and l.company_id=held.company_id
    and l.source='hermes_agent_audit' and l.action=public.log_agent_action('MOVE_AGENT_PROFILE');
  end if;
  if coalesce(morning,false) or (moved_at is not null and exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.created_at<moved_at)) then
   select jsonb_agg(x.entry order by x.id) into record from (
    select m.id,e.entry,sum(octet_length(e.entry::text)) over (order by m.id desc) as total
    from public.conversation_messages m,
     lateral (select jsonb_build_object('role',case m.author when 'agent' then 'assistant' else 'user' end,'content',m.body) as entry) e
    where m.conversation_id=conversation and m.send_key is distinct from message_key) x
   where x.total<=6000000;
   if record is not null then
    update public.conversation_run_notes n set history=record where n.conversation_id=conversation and n.send_key=message_key returning * into kept;
   end if;
  end if;
 end if;
 return kept.history;
end $function$;
