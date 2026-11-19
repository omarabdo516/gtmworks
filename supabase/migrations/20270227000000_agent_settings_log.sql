-- #125: an Engine setting changed on an Agent's profile is one row in the Company log, with the setting, the Agent and
-- the values before and after (`setting`, `old`, `new`). Only an active Owner writes one; the app checks the Role too and
-- reaches the Engine first, but the log itself is written here, so a Member below Owner cannot forge the row.
--
-- The Agent log line keeps the three values (from 20270214000000's body). Nothing existing is rewritten: the function
-- only gains keys, and no old row carries them. The previous app version never calls log_engine_setting.

create or replace function public.log_agent_event(c uuid, actor uuid, actor_name text, agent uuid, act text, details jsonb)
 returns void language sql security definer set search_path='' as $$
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,actor,public.log_actor_kind(c,actor),coalesce(actor_name,(select name from public.people where id=actor)),
   'agent',agent,public.log_agent_action(act),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=agent),'replacement_id',details->'replacement_id','job',details->'job','rule',details->'rule','taught_by',details->'taught_by','asked_for',details->'asked_for','asked_by',details->'asked_by','reason',details->'reason','private',details->'private','teller',details->'teller','skill',details->'skill','setting',details->'setting','old',details->'old','new',details->'new')),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
$$;
revoke all on function public.log_agent_event(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated,service_role;

-- One setting changed on one Agent, as the signed-in Owner. A value that looks like a credential is refused, and a
-- setting name that is not the Engine's dotted key shape, so the log can only name a setting, never hold a key.
create function public.log_engine_setting(c uuid, agent uuid, setting text, old_value jsonb, new_value jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'settingNotAllowed' using errcode='42501'; end if;
 if setting is null or setting !~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$' then raise exception 'settingInvalid' using errcode='22023'; end if;
 if not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c) then raise exception 'settingAgentUnknown' using errcode='P0002'; end if;
 if jsonb_typeof(coalesce(old_value,'null'::jsonb)) not in ('null','string','number','boolean')
  or jsonb_typeof(coalesce(new_value,'null'::jsonb)) not in ('null','string','number','boolean')
  then raise exception 'settingInvalid' using errcode='22023'; end if;
 if public.secret_like(coalesce(old_value#>>'{}','')) or public.secret_like(coalesce(new_value#>>'{}',''))
  then raise exception 'settingSecret' using errcode='22023'; end if;
 perform public.log_agent_event(c,auth.uid(),null,agent,'AGENT_SETTING_CHANGED',jsonb_build_object('setting',setting,'old',old_value,'new',new_value));
end $$;
revoke all on function public.log_engine_setting(uuid,uuid,text,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.log_engine_setting(uuid,uuid,text,jsonb,jsonb) to authenticated;
