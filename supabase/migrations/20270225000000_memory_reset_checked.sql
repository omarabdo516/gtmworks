-- Review of spec #353 (#350): an Agent's memory is its own Engine profile's. Clearing it deletes that Agent's notes for
-- good, so it is the Owner's alone and the Company log keeps one row of it: check_memory_reset checks the Role before the
-- Engine is changed, and log_memory_reset records it once the Engine holds the reset, naming the person and the Agent and
-- nothing of the notes. A Member the Agent is hidden from is not a row in hermes_agents for them either, so the read of
-- the Agent is the same check as for any other Agent (#15).

create function public.check_memory_reset(c uuid, agent uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) or not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c)
  then raise exception 'memoryNotAllowed' using errcode='42501'; end if;
end $$;
revoke all on function public.check_memory_reset(uuid,uuid) from public,anon,service_role;
grant execute on function public.check_memory_reset(uuid,uuid) to authenticated;

-- The reset as one row on the Agent, as a skill change is (20270214000000): who, the Agent, and no note text.
create function public.log_memory_reset(c uuid, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_memory_reset(c,agent);
 perform public.log_agent_event(c,auth.uid(),null,agent,'memory_reset','{}'::jsonb);
end $$;
revoke all on function public.log_memory_reset(uuid,uuid) from public,anon,service_role;
grant execute on function public.log_memory_reset(uuid,uuid) to authenticated;
