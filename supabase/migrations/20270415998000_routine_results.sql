-- #535: each Routine result is kept as it ends. The Engine lists at most the newest 100 runs of a job and has no paging
-- (v0.23.0 web_routers/cron.py 485-538), so a Routine that ran more often than that between two mornings lost its oldest
-- results when the morning read its night from the Engine (#183, #524). The worker now reads each Routine's finished runs
-- on its passes and keeps each one here once, with its Agent, its Routine and the first line of its reply; the morning
-- draws its night from what was kept. A run whose reply sent nothing ([SILENT], or none) is kept with no line, so it is
-- read once and never shown. Rows older than 30 days go on the next keep: a morning's own results are copied into
-- good_morning_results when it is recorded, so this is the worker's working set, not the record.
create table public.routine_results (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id) on delete cascade,
 agent_id uuid not null references public.hermes_agents(id) on delete cascade,
 profile text not null check (profile ~ '^(co|ag)-[0-9a-f]{32}$'),
 routine_id text not null check (routine_id ~ '^[0-9a-f]{6,64}$'),
 session_id text not null check (session_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 routine text check (length(routine) between 1 and 200),
 line text check (length(line) between 1 and 300),
 ended_at timestamptz not null,
 created_at timestamptz not null default now(),
 unique(company_id,profile,session_id)
);
create index routine_results_night on public.routine_results(company_id,ended_at desc);
-- The worker alone reads and writes it, through the functions below; no Member reads it (a morning's card reads
-- good_morning_results, under can_see_agent).
alter table public.routine_results enable row level security;
revoke all on public.routine_results from anon,authenticated,service_role;

-- The sessions of a profile's runs already kept, so the worker reads each run's reply once.
create function public.routine_results_seen(c uuid, at_profile text, sessions text[]) returns setof text
language sql stable security definer set search_path='' as $$
 select r.session_id from public.routine_results r where r.company_id=c and r.profile=at_profile and r.session_id=any(sessions);
$$;
revoke all on function public.routine_results_seen(uuid,text,text[]) from public,anon,authenticated;
grant execute on function public.routine_results_seen(uuid,text,text[]) to service_role;

-- Keeps finished runs once each (a run kept already is left as it is) for Agents of the Company, and lets go of what
-- ended over 30 days ago. Answers how many were new.
create function public.keep_routine_results(c uuid, results jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 if results is null or jsonb_typeof(results)<>'array' or jsonb_array_length(results)>500 then raise exception 'routineResultsInvalid' using errcode='22023'; end if;
 insert into public.routine_results(company_id,agent_id,profile,routine_id,session_id,routine,line,ended_at)
  select c,(r->>'agent')::uuid,r->>'profile',r->>'routine_id',r->>'session',nullif(left(trim(coalesce(r->>'routine','')),200),''),
   nullif(left(trim(coalesce(r->>'line','')),300),''),(r->>'at')::timestamptz
  from jsonb_array_elements(results) r
  where exists(select 1 from public.hermes_agents a where a.id=(r->>'agent')::uuid and a.company_id=c)
  on conflict (company_id,profile,session_id) do nothing;
 get diagnostics added=row_count;
 delete from public.routine_results r where r.company_id=c and r.ended_at<now()-interval '30 days';
 return added;
end $$;
revoke all on function public.keep_routine_results(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.keep_routine_results(uuid,jsonb) to service_role;

-- A morning's night: the newest 200 kept results with a line that ended after `since` and by `until`, each with its
-- Agent, its Routine and its line, as record_good_morning takes them.
create function public.good_morning_night(c uuid, since timestamptz, until timestamptz) returns table(agent uuid, routine text, line text, at timestamptz)
language sql stable security definer set search_path='' as $$
 select r.agent_id,r.routine,r.line,r.ended_at from public.routine_results r
 where r.company_id=c and r.ended_at>since and r.ended_at<=until and r.routine is not null and r.line is not null
 order by r.ended_at desc,r.id limit 200;
$$;
revoke all on function public.good_morning_night(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.good_morning_night(uuid,timestamptz,timestamptz) to service_role;
