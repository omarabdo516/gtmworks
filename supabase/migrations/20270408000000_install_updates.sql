-- #443: Update now. The web app records only that an Owner asked for an update; the updater on the host (scripts/get.sh,
-- `gtmworks updater`) reads that, chooses the version itself (the newest of the install's own channel) and writes back
-- what happened. The install owner's switches (`gtmworks update-button`, `gtmworks auto-update`) live here too, and only
-- the updater, as postgres, writes them: the app's roles, the service role included, reach this row through the two
-- functions below alone (ADR 0020).
create table public.install_updates (
 singleton boolean primary key default true check(singleton),
 button boolean not null default true,
 auto boolean not null default false,
 state text not null default 'idle' check(state in ('idle','requested','updating','updated','failed')),
 -- updated: the version now running; failed: the version still running after the failed update was put back.
 version text check(version ~ '^(v[0-9]+\.[0-9]+\.[0-9]+|main(@sha256:[a-f0-9]{64})?)$'),
 requested_by uuid references public.people(id) on delete set null,
 changed_at timestamptz not null default now(),
 auto_checked_at timestamptz
);
insert into public.install_updates default values;
alter table public.install_updates enable row level security;
revoke all on public.install_updates from public, anon, authenticated, service_role;

-- An active Owner of any Company of the install reads the state; anyone else reads nothing. A missing row (a test reset
-- emptied the table) reads as the defaults.
create function public.install_update() returns json language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.members where person_id=auth.uid() and removed_at is null and role='owner') then
  (select json_build_object('button',coalesce(u.button,true),'state',coalesce(u.state,'idle'),'version',u.version,'changedAt',u.changed_at)
   from (select 1) one left join public.install_updates u on u.singleton)
 end;
$$;
-- An Owner asks for an update while the button is on; asking again while one is waiting or running changes nothing.
-- Nothing of the request but its time and its Owner is kept: the updater never reads a version from here.
create function public.request_install_update() returns text language plpgsql security definer set search_path='' as $$
declare now_state text;
begin
 if not exists(select 1 from public.members where person_id=auth.uid() and removed_at is null and role='owner') then
  raise exception 'updateNotAllowed' using errcode='42501';
 end if;
 insert into public.install_updates default values on conflict do nothing;
 if not (select button from public.install_updates) then raise exception 'updateButtonOff' using errcode='42501'; end if;
 update public.install_updates set state='requested', requested_by=auth.uid(), changed_at=now()
  where state not in ('requested','updating');
 select state into now_state from public.install_updates;
 return now_state;
end $$;
revoke all on function public.install_update(), public.request_install_update() from public, anon, service_role;
grant execute on function public.install_update(), public.request_install_update() to authenticated;
