-- Review of spec #353 (#191): one note of an Agent's memory is rewritten or removed by the id the Engine gave it, so who
-- may change one and the log of each change stay in gtmworks, as a reset does (20270219000000). check_memory_edit checks
-- an edit before the Engine is changed: an active Owner or Manager of the Company, an Agent of that Company, and a note
-- id that is a memory note's (never a skill's). check_memory_forget checks a removal: the Owner alone, as a reset is.
-- log_memory_edit and log_memory_forget record one row of the Company log each once the Engine holds the change, naming
-- the person and the Agent and nothing of the note: a forgotten note is not kept in the log.
--
-- The note id is the Engine's own `memory:<memory|profile>:<index>[:<fingerprint>]` (agent/learning_graph.py
-- memory_node_id). A legacy id without a fingerprint is still a memory note's, so it is accepted; anything else is
-- refused. The app refuses an id that is not one before asking the Engine too (lib/hermes.mjs), so no call can reach a
-- skill.

create function public.check_memory_edit(c uuid, agent uuid, note text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_manage_company(c) or not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c)
  then raise exception 'memoryNotAllowed' using errcode='42501'; end if;
 if note is not null and note !~ '^memory:(memory|profile):[0-9]{1,9}(:[0-9a-f]{12})?$'
  then raise exception 'memoryInvalid' using errcode='22023'; end if;
end $$;
revoke all on function public.check_memory_edit(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.check_memory_edit(uuid,uuid,text) to authenticated;

create function public.check_memory_forget(c uuid, agent uuid, note text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) or not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c)
  then raise exception 'memoryNotAllowed' using errcode='42501'; end if;
 if note is not null and note !~ '^memory:(memory|profile):[0-9]{1,9}(:[0-9a-f]{12})?$'
  then raise exception 'memoryInvalid' using errcode='22023'; end if;
end $$;
revoke all on function public.check_memory_forget(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.check_memory_forget(uuid,uuid,text) to authenticated;

-- The edit as one row on the Agent, as a skill change is (20270214000000): who, the Agent, and no note text.
create function public.log_memory_edit(c uuid, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_memory_edit(c,agent,null);
 perform public.log_agent_event(c,auth.uid(),null,agent,'memory_edit','{}'::jsonb);
end $$;
revoke all on function public.log_memory_edit(uuid,uuid) from public,anon,service_role;
grant execute on function public.log_memory_edit(uuid,uuid) to authenticated;

-- The removal as one row on the Agent: who, the Agent, and nothing of the note, which is gone from the Engine too.
create function public.log_memory_forget(c uuid, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_memory_forget(c,agent,null);
 perform public.log_agent_event(c,auth.uid(),null,agent,'memory_forget','{}'::jsonb);
end $$;
revoke all on function public.log_memory_forget(uuid,uuid) from public,anon,service_role;
grant execute on function public.log_memory_forget(uuid,uuid) to authenticated;
