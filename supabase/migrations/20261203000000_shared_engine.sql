-- Until each company has its own Engine home (#2), the companies whose agents run on the bundled Engine profile share
-- its memory (ADR 0010): an agent can repeat one company's facts to people in another. A company's Owner (or the Agency)
-- is told while that is so. The bundled profile is the address and profile of a Connection the worker provided
-- (its PROVIDE_BUNDLED_HERMES_AGENT audit row); a company is on it when one of its agents uses that address and profile.
-- Only a yes or no is returned: no other company, Connection or address is revealed.
create function public.bundled_engine_shared(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select (public.agency_access() or exists(select 1 from public.members where company_id=c and person_id=auth.uid() and role='owner' and removed_at is null))
  and exists(select 1 from (select distinct h.address,h.profile from public.hermes_agent_audit u join public.hermes_connections h on h.id=(u.details->>'connection_id')::uuid
    where u.action='PROVIDE_BUNDLED_HERMES_AGENT') b
   join public.hermes_connections h on h.address=b.address and h.profile=b.profile join public.hermes_agents a on a.connection_id=h.id
   group by b.address,b.profile having bool_or(a.company_id=c) and count(distinct a.company_id)>1);
$$;
revoke all on function public.bundled_engine_shared(uuid) from public,anon,service_role;
grant execute on function public.bundled_engine_shared(uuid) to authenticated;
