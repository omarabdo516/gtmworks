-- #176: an Agent's standing instructions are the text of its own profile's SOUL.md, saved from its page in Settings by
-- the Owner alone (Omar, 2026-11-18): the server refuses a Manager, a Contributor and a Viewer. check_agent_owner_setting
-- checks the save before the Engine is written (an active Owner of the Company, an Agent of that Company, and one they
-- see), and log_agent_instructions writes the one Company log row once the Engine holds the change: who, the Agent and
-- the field. The instructions themselves never reach the row: the field alone reads as "Edited".

create function public.check_agent_owner_setting(c uuid, agent uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_company_owner(c)
  or not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c)
  or not public.agent_visible_to(c,auth.uid(),agent)
  then raise exception 'agentSettingNotAllowed' using errcode='42501'; end if;
end $$;
revoke all on function public.check_agent_owner_setting(uuid,uuid) from public,anon,service_role;
grant execute on function public.check_agent_owner_setting(uuid,uuid) to authenticated;

create function public.log_agent_instructions(c uuid, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_agent_owner_setting(c,agent);
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),
   'agent',agent,'agent_setting_changed',
   jsonb_build_object('agent_name',(select name from public.hermes_agents where id=agent),'field','instructions'),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
end $$;
revoke all on function public.log_agent_instructions(uuid,uuid) from public,anon,service_role;
grant execute on function public.log_agent_instructions(uuid,uuid) to authenticated;
