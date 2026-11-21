-- #182: Good morning's changes are serialized per Company. A save of the switch or the time, and a change of the main
-- Agent (which moves the message), each read the Agents, ask the Engine and write the log in several steps; run side by
-- side they could leave the daily message on an Agent that is no longer the main one. So each holds the Company's
-- lease for its whole run: take_morning_lease takes it when it is free or its holder's time is up (a holder that
-- crashed cannot keep it), renew_morning_lease is asked before every Engine write and answers true only while this
-- holder's lease has not run out (a holder whose time ran out, even with nobody else holding it since, stops: what it
-- read may be stale), drop_morning_lease gives it back. Only an Owner or a Manager of the Company takes one, as only
-- they change the message or the main Agent; the table itself is reached through these functions alone.
-- `profiles` are the Engine profiles a change of the main Agent must still settle the message on (an Agent's about to be
-- removed among them): they are written before the change and cleared only once a settle left the message on the main
-- Agent alone, so a settle that failed is finished by a later one whatever else forgot the removed Agent's profile.
create table public.agent_morning_leases (
 company_id uuid primary key references public.companies(id) on delete cascade,
 holder uuid not null,
 until timestamptz not null,
 profiles text[] not null default '{}' check (cardinality(profiles)<=200)
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

create function public.renew_morning_lease(c uuid, holder uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not public.can_manage_company(c) then raise exception 'agentSettingNotAllowed' using errcode='42501'; end if;
 update public.agent_morning_leases l set until=now()+interval '60 seconds'
  where l.company_id=c and l.holder=renew_morning_lease.holder and l.until>=now();
 return found;
end $$;
revoke all on function public.renew_morning_lease(uuid,uuid) from public,anon,service_role;
grant execute on function public.renew_morning_lease(uuid,uuid) to authenticated;

-- Adds `adding` to the profiles still to settle and takes `settled` off, for a holder whose lease is running; answers
-- the list, or null when the lease is not this holder's.
create function public.morning_lease_profiles(c uuid, holder uuid, adding text[], settled text[]) returns text[]
language plpgsql security definer set search_path='' as $$
declare kept text[];
begin
 if not public.can_manage_company(c) then raise exception 'agentSettingNotAllowed' using errcode='42501'; end if;
 if exists(select 1 from unnest(coalesce(adding,'{}')) p where p !~ '^(co|ag)-[0-9a-f]{32}$') then raise exception 'agentSettingInvalid' using errcode='22023'; end if;
 update public.agent_morning_leases l set profiles=coalesce((select array_agg(distinct p order by p) from unnest(l.profiles||coalesce(adding,'{}')) p
   where p<>all(coalesce(settled,'{}'))),'{}')
  where l.company_id=c and l.holder=morning_lease_profiles.holder and l.until>=now()
  returning l.profiles into kept;
 return kept;
end $$;
revoke all on function public.morning_lease_profiles(uuid,uuid,text[],text[]) from public,anon,service_role;
grant execute on function public.morning_lease_profiles(uuid,uuid,text[],text[]) to authenticated;

-- Given back by ending its time, so the profiles still to settle stay for the next holder.
create function public.drop_morning_lease(c uuid, holder uuid) returns void
language sql security definer set search_path='' as $$
 update public.agent_morning_leases l set until=now()-interval '1 second' where l.company_id=c and l.holder=drop_morning_lease.holder;
$$;
revoke all on function public.drop_morning_lease(uuid,uuid) from public,anon,service_role;
grant execute on function public.drop_morning_lease(uuid,uuid) to authenticated;

-- Make it main and removing an Agent, under the lease (the route's only way to change the main Agent): the lease is
-- renewed and the change made in one transaction, and the renewal's row lock holds until it commits, so no other holder
-- takes the lease between the check and the change. A holder whose lease ran out changes nothing.
create function public.manage_hermes_agent_leased(c uuid, holder uuid, intent text, a uuid, replacement uuid default null) returns void
language plpgsql set search_path='' as $$
begin
 if not public.renew_morning_lease(c,holder) then raise exception 'morningLeaseLost' using errcode='55P03'; end if;
 perform public.manage_hermes_agent(c,intent,a,replacement);
end $$;
revoke all on function public.manage_hermes_agent_leased(uuid,uuid,text,uuid,uuid) from public,anon,service_role;
grant execute on function public.manage_hermes_agent_leased(uuid,uuid,text,uuid,uuid) to authenticated;
