-- #712: "Wake it" on an Agent's Screen. Any Member who sees the Agent and is not a Viewer may wake it (the reference's
-- canWrite); the app asks the database first, before the Engine is asked to start it, and logs the wake once it is
-- awake: one row with the person and the Agent. Additive: two functions; the previous app version calls neither.

-- Raises unless the caller may wake this Agent's Screen: a Member of the Company who is not a Viewer, an Agent of that
-- Company, and one the caller sees.
create function public.check_screen_wake(c uuid, agent uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.conversation_can_write(c) or not public.can_see_agent(c,agent)
  or not exists(select 1 from public.hermes_agents h where h.id=agent and h.company_id=c)
  then raise exception 'screenNotAllowed' using errcode='42501'; end if;
end $$;
revoke all on function public.check_screen_wake(uuid,uuid) from public,anon,service_role;
grant execute on function public.check_screen_wake(uuid,uuid) to authenticated;

-- The Company log's row for a Screen a person woke: the person is the row's actor, on the Agent's subject.
create function public.log_screen_woken(c uuid, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_screen_wake(c,agent);
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),'agent',agent,'agent_screen_woken',
   jsonb_build_object('agent_name',(select name from public.hermes_agents where id=agent)),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
end $$;
revoke all on function public.log_screen_woken(uuid,uuid) from public,anon,service_role;
grant execute on function public.log_screen_woken(uuid,uuid) to authenticated;
