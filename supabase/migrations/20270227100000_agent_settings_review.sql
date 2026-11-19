-- #352's review of the settings pages: a setting log row can only name the two fields whose text this version keeps
-- outside the log (About and Voice), and never carries a value of its own. The fields are the page's own sections; a
-- Manager could otherwise write a row for any field with any old and new text. About and Voice already call with no
-- values (lib/agent-about.mjs, lib/agent-voice.mjs), so nothing the app writes changes. Additive: the function is made
-- again with the same signature, and the previous app version calls it exactly as before.
create or replace function public.log_agent_setting(c uuid, agent uuid, field text, old_value text, new_value text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.check_agent_setting(c,agent);
 -- A field this version has no words for is never written, and a row this page writes keeps no text: the field alone.
 if field is null or field not in ('about','voice') then raise exception 'agentSettingInvalid' using errcode='22023'; end if;
 if old_value is not null or new_value is not null then raise exception 'agentSettingInvalid' using errcode='22023'; end if;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),
   'agent',agent,'agent_setting_changed',
   jsonb_strip_nulls(jsonb_build_object(
    'agent_name',(select name from public.hermes_agents where id=agent),
    'field',field)),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
end $$;
revoke all on function public.log_agent_setting(uuid,uuid,text,text,text) from public,anon,service_role;
grant execute on function public.log_agent_setting(uuid,uuid,text,text,text) to authenticated;

-- #29's rows: an Agent is choosable only while its Engine profile is the one its Agent record names. An Agent the worker
-- is moving still names the Company's `co-` profile for a while, so its own record exists but its model is not its own yet;
-- it is written with the Company default until the move finishes. Additive: the columns stay as they were.
create or replace function public.company_agent_models(c uuid)
returns table(agent uuid, name text, profile text, own boolean, choosable boolean, model_choice text, subagents boolean)
language sql stable security definer set search_path='' as $$
 select a.id,a.name,a.profile,
  (a.profile=p.profile and a.id=public.company_profile_keeper(c)) or exists(select 1 from public.agent_profiles ap where ap.agent_id=a.id and ap.company_id=c and ap.profile=a.profile),
  g.agent_id is not null and g.profile=a.profile,
  g.model_choice,coalesce(g.subagents,false)
 from public.hermes_agents a
  join public.company_profiles p on p.company_id=c
  left join public.agent_profiles g on g.agent_id=a.id and g.company_id=c
 where a.company_id=c and public.can_see_agent(c,a.id)
  and (a.profile=p.profile or a.profile=public.agent_engine_profile(a.id))
 order by a.is_default desc,a.name,a.id;
$$;
revoke all on function public.company_agent_models(uuid) from public,anon,service_role;
grant execute on function public.company_agent_models(uuid) to authenticated;

-- #28: an Agent's own learning mode is remembered here, as #29 remembers its model choice. null means the Agent follows
-- whatever the Company chooses (the Company's write then reaches its profile); "auto" or "ask" means its Owner chose
-- for this Agent alone, and a Company-wide change leaves its profile alone. Additive: no existing row is rewritten.
alter table public.agent_profiles add column learning_mode_choice text;
alter table public.agent_profiles add constraint agent_profiles_learning_mode_choice_shape
 check (learning_mode_choice is null or learning_mode_choice in ('auto','ask'));

-- What the Learning section reads with each Agent's mode: whether it chose its own, or follows the Company.
create function public.company_learning_modes(c uuid)
returns table(agent uuid, learning_mode_choice text)
language sql stable security definer set search_path='' as $$
 select a.id,g.learning_mode_choice
 from public.hermes_agents a
  left join public.agent_profiles g on g.agent_id=a.id and g.company_id=c
 where a.company_id=c and public.can_see_agent(c,a.id)
 order by a.is_default desc,a.name,a.id;
$$;
revoke all on function public.company_learning_modes(uuid) from public,anon,service_role;
grant execute on function public.company_learning_modes(uuid) to authenticated;

-- An Owner remembers one Agent's own mode, or null to follow the Company again. The Engine's two approvals are written
-- by the app; this row only keeps the choice.
create function public.set_agent_learning_mode(agent uuid, mode text) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 if mode is not null and mode not in ('auto','ask') then raise exception 'learningModeInvalid' using errcode='22023'; end if;
 select a.company_id into c from public.hermes_agents a where a.id=set_agent_learning_mode.agent;
 if c is null then raise exception 'settingAgentUnknown' using errcode='P0002'; end if;
 if not public.is_company_owner(c) then raise exception 'settingNotAllowed' using errcode='42501'; end if;
 update public.agent_profiles p set learning_mode_choice=set_agent_learning_mode.mode where p.agent_id=set_agent_learning_mode.agent and p.company_id=c;
 if not found then raise exception 'settingAgentShared' using errcode='42501'; end if;
end $$;
revoke all on function public.set_agent_learning_mode(uuid,text) from public,anon,service_role;
grant execute on function public.set_agent_learning_mode(uuid,text) to authenticated;
