-- #182: Good morning's changes are serialized per Company. A save of the switch or the time, and a change of the main
-- Agent (which moves the message), each read the Agents, ask the Engine and write the log in several steps; run side by
-- side they could leave the daily message on an Agent that is no longer the main one. So each holds the Company's
-- lease for its whole run: take_morning_lease takes it when it is free or its holder's time is up (a holder that
-- crashed cannot keep it), drop_morning_lease gives it back. Only an Owner or a Manager of the Company takes one, as
-- only they change the message or the main Agent; the table itself is reached through these two functions alone.
create table public.agent_morning_leases (
 company_id uuid primary key references public.companies(id) on delete cascade,
 holder uuid not null,
 until timestamptz not null
);
alter table public.agent_morning_leases enable row level security;
revoke all on public.agent_morning_leases from anon,authenticated,service_role;

create function public.take_morning_lease(c uuid, holder uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not public.can_manage_company(c) then raise exception 'agentSettingNotAllowed' using errcode='42501'; end if;
 insert into public.agent_morning_leases(company_id,holder,until) values(c,holder,now()+interval '60 seconds')
  on conflict (company_id) do update set holder=excluded.holder,until=excluded.until
  where public.agent_morning_leases.until<now() or public.agent_morning_leases.holder=excluded.holder;
 return exists(select 1 from public.agent_morning_leases l where l.company_id=c and l.holder=take_morning_lease.holder);
end $$;
revoke all on function public.take_morning_lease(uuid,uuid) from public,anon,service_role;
grant execute on function public.take_morning_lease(uuid,uuid) to authenticated;

create function public.drop_morning_lease(c uuid, holder uuid) returns void
language sql security definer set search_path='' as $$
 delete from public.agent_morning_leases l where l.company_id=c and l.holder=drop_morning_lease.holder;
$$;
revoke all on function public.drop_morning_lease(uuid,uuid) from public,anon,service_role;
grant execute on function public.drop_morning_lease(uuid,uuid) to authenticated;
