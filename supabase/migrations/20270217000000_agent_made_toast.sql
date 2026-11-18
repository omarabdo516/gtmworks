-- #169: an Agent Lead makes at the Owner's request says so once, in the Conversation where it appears. The toast's
-- "Open {Agent}" action and a reload ask for the same record, so the database keeps whether that Agent's requester has
-- already been told. Additive: one empty column and one function; the previous app version reads the Agent as before.
alter table public.hermes_agents add column requester_toasted_at timestamptz;

-- Marks the Agent as told to the person who asked for it, and answers whether this call was the first. Only the Agent's
-- requester may mark it, once; another Member, another Company's Agent or a second call changes nothing.
create function public.mark_agent_toast_shown(agent uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare shown uuid;
begin
 update public.hermes_agents set requester_toasted_at=now()
  where id=agent and requested_by=auth.uid() and requester_toasted_at is null and public.is_member(company_id)
  returning id into shown;
 return shown is not null;
end $$;
revoke all on function public.mark_agent_toast_shown(uuid) from public,anon,service_role;
grant execute on function public.mark_agent_toast_shown(uuid) to authenticated;
