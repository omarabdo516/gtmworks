-- #182: Good morning is the main Agent's daily message, one scheduled job of its own Engine profile, so the Engine keeps
-- its time and switch and gtmworks keeps no schedule. Who may change it stays in gtmworks: check_agent_setting (an active
-- Owner or Manager who sees the Agent) is asked before the Engine, and log_agent_morning writes one row of the Company
-- log once the Engine holds the change, on the Agent, naming who and the old and new value: "off", a time such as 9:00,
-- or the five-field schedule an Agent was asked for in a chat. It reads like every field of the Agent's page
-- (agent_setting_changed, field `morning`). log_agent_setting stays as #161 left it, for fields that keep no value.
create function public.log_agent_morning(c uuid, agent uuid, old_value text, new_value text, change uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_agent_setting(c,agent);
 if not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c and a.is_default)
  or old_value is null or new_value is null or old_value=new_value
  or old_value !~ '^(off|other|([01]?[0-9]|2[0-3]):[0-5][0-9]|[0-9*,/-]{1,20}( [0-9*,/-]{1,20}){4})$'
  or new_value !~ '^(off|other|([01]?[0-9]|2[0-3]):[0-5][0-9]|[0-9*,/-]{1,20}( [0-9*,/-]{1,20}){4})$'
  or change is null
  then raise exception 'agentSettingInvalid' using errcode='22023'; end if;
 -- The change's own key: a write tried again after a lost answer is one row, never two. Two writes of one change that
 -- overlap wait for each other here, so the second sees the first's row.
 perform pg_advisory_xact_lock(hashtextextended('agent_morning:'||change::text,0));
 if exists(select 1 from public.company_log l where l.company_id=c and l.agent_id=agent and l.action='agent_setting_changed'
  and l.details->>'field'='morning' and l.details->>'change'=change::text) then return; end if;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),
   'agent',agent,'agent_setting_changed',
   jsonb_build_object('agent_name',(select name from public.hermes_agents where id=agent),'field','morning','old',old_value,'new',new_value,'change',change),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
end $$;
revoke all on function public.log_agent_morning(uuid,uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.log_agent_morning(uuid,uuid,text,text,uuid) to authenticated;
