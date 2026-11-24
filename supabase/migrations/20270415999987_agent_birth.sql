-- #701: a made Agent is born once for the person who asked for it, on its card and its sidebar tile. A reload while it
-- is being born, another device and another Member must not see it again, so the database keeps whether that Agent's
-- requester has seen it. Additive: one empty column and one function; the previous app version reads the Agent as before.
alter table public.hermes_agents add column requester_born_at timestamptz;

-- Marks the Agent as born for the person who asked for it, and answers whether this call was the first. Only the
-- Agent's requester may mark it, once; another Member, another Company's Agent or a second call changes nothing.
create function public.mark_agent_born(agent uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare born uuid;
begin
 update public.hermes_agents set requester_born_at=now()
  where id=agent and requested_by=auth.uid() and requester_born_at is null and public.is_member(company_id)
  returning id into born;
 return born is not null;
end $$;
revoke all on function public.mark_agent_born(uuid) from public,anon,service_role;
grant execute on function public.mark_agent_born(uuid) to authenticated;
