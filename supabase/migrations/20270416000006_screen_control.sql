-- #713: "Take control" of an Agent's Screen for one session, and "Done". Any Member who sees the Agent and is not a
-- Viewer may take control (the reference's canWrite, as for "Wake it"); the app asks the database first, before the
-- Engine is asked for the lease, and the check answers the person's name, which the view shows to anyone else watching
-- ("{name} has control"). Taking control and giving it back are one Company log row each, with the person and the
-- Agent. Giving back is never refused for the Role: a person whose Role changed while they held the Screen still hands
-- it back, and it is logged, as long as they are still a Member who sees the Agent. Additive: three functions; the
-- previous app version calls none.

-- Raises unless the caller may take control of this Agent's Screen; answers the caller's name.
create function public.check_screen_control(c uuid, agent uuid) returns text
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.check_screen_wake(c,agent);
 return coalesce((select name from public.people where id=auth.uid()),'');
end $$;
revoke all on function public.check_screen_control(uuid,uuid) from public,anon,service_role;
grant execute on function public.check_screen_control(uuid,uuid) to authenticated;

-- The Company log's row for control of a Screen a person took: the person is the row's actor, on the Agent's subject.
create function public.log_screen_taken(c uuid, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_screen_wake(c,agent);
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),'agent',agent,'agent_screen_taken',
   jsonb_build_object('agent_name',(select name from public.hermes_agents where id=agent)),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
end $$;
revoke all on function public.log_screen_taken(uuid,uuid) from public,anon,service_role;
grant execute on function public.log_screen_taken(uuid,uuid) to authenticated;

-- The row for control a person gave back (Done, closing the view, leaving the page or losing the connection): any
-- Member of the Company who still sees the Agent.
create function public.log_screen_given_back(c uuid, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_member(c) or not public.can_see_agent(c,agent)
  or not exists(select 1 from public.hermes_agents h where h.id=agent and h.company_id=c)
  then raise exception 'screenNotAllowed' using errcode='42501'; end if;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),'agent',agent,'agent_screen_given_back',
   jsonb_build_object('agent_name',(select name from public.hermes_agents where id=agent)),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
end $$;
revoke all on function public.log_screen_given_back(uuid,uuid) from public,anon,service_role;
grant execute on function public.log_screen_given_back(uuid,uuid) to authenticated;
