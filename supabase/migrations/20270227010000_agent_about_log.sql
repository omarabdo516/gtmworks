-- #161: an Agent's settings are saved from its page in Settings and logged as one row of the Company log per changed
-- field. About is the description of the Agent's own profile in the Engine; check_agent_setting checks a save before the
-- Engine is written (an active Owner or Manager of the Company, an Agent of that Company, and one they see), and
-- log_agent_setting writes the row once the Engine holds the change: who, the Agent, the field, and the old and new
-- values. About's row keeps no text (the description may be long): the field alone, read as "Edited". Later fields of
-- the page use the same two functions with their own field names.

create function public.check_agent_setting(c uuid, agent uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_manage_company(c)
  or not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c)
  or not public.agent_visible_to(c,auth.uid(),agent)
  then raise exception 'agentSettingNotAllowed' using errcode='42501'; end if;
end $$;
revoke all on function public.check_agent_setting(uuid,uuid) from public,anon,service_role;
grant execute on function public.check_agent_setting(uuid,uuid) to authenticated;

create function public.log_agent_setting(c uuid, agent uuid, field text, old_value text, new_value text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_agent_setting(c,agent);
 -- A field this version has no words for is never written, and neither is a value long enough to bloat the log.
 if field is null or field !~ '^[a-z][a-z0-9_]{0,31}$'
  or length(coalesce(old_value,''))>500 or length(coalesce(new_value,''))>500
  then raise exception 'agentSettingInvalid' using errcode='22023'; end if;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),
   'agent',agent,'agent_setting_changed',
   jsonb_strip_nulls(jsonb_build_object(
    'agent_name',(select name from public.hermes_agents where id=agent),
    'field',field,'old',old_value,'new',new_value)),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
end $$;
revoke all on function public.log_agent_setting(uuid,uuid,text,text,text) from public,anon,service_role;
grant execute on function public.log_agent_setting(uuid,uuid,text,text,text) to authenticated;
