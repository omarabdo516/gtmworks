-- #30, per Agent: the Owner turns an app on or off for each Agent. Each Agent is one Engine profile (ADR 0016), and an
-- app is on for an Agent when its server is in that profile's config, so the Engine stays the only record of who has
-- which app. gtmworks learns here which Agents an app can be turned on for and the profile each runs on, keeps the
-- Agent a sign-in is for, and logs each connect and disconnect with its Agent.
--
-- Nothing existing is rewritten: both new columns are null on every old row (a sign-in with no Agent is the main
-- profile's, as the previous version started it; a log row with no Agent was for the whole Company). The 3- and
-- 2-argument functions stay as they are, so the previous app version runs against this database unchanged.

-- The Company's Agents the caller sees on the bundled Engine, the main one first, each with its profile. `own`: the
-- profile is the Agent's alone, the Company profile's keeper (company_profile_keeper, the main Agent before the first
-- move) or an `ag-` profile whose owner record names it. An Agent #121 has not moved yet shares the keeper's profile and
-- is listed with own false: nothing can be turned on for it alone.
create function public.company_app_agents(c uuid) returns table(agent uuid, name text, connection uuid, profile text, main boolean, own boolean)
language sql stable security definer set search_path='' as $$
 select a.id,a.name,a.connection_id,h.profile,a.is_default,
  (h.profile=p.profile and a.id=public.company_profile_keeper(c))
   or exists(select 1 from public.agent_profiles g where g.agent_id=a.id and g.company_id=c and g.profile=h.profile)
 from public.hermes_agents a join public.hermes_connections h on h.id=a.connection_id
  join public.company_profiles p on p.company_id=c
 where a.company_id=c and public.is_bundled_connection(h.id) and public.can_see_agent(c,a.id)
  and (h.profile=p.profile or h.profile=public.agent_engine_profile(a.id))
 order by a.is_default desc,a.name,a.id;
$$;
revoke all on function public.company_app_agents(uuid) from public,anon,service_role;
grant execute on function public.company_app_agents(uuid) to authenticated;

alter table public.company_app_sign_ins add column agent_id uuid;
-- No foreign key: a removed Agent's log rows keep its id, as company_profile_keepers does.
alter table public.company_audit add column agent_id uuid;

-- The Owner started a sign-in for one Agent whose profile is its own. As the 3-argument one, any other open sign-in of
-- theirs for that app, in any Company or for any Agent, is forgotten, so the vendor's way back matches one sign-in only.
create function public.start_app_sign_in(c uuid, app_key text, flow text, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'appsNotAllowed' using errcode='42501'; end if;
 if coalesce(app_key,'') !~ '^[a-z][a-z0-9-]{0,63}$' or coalesce(flow,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'appsInvalid' using errcode='22023'; end if;
 if not exists(select 1 from public.company_app_agents(c) x where x.agent=start_app_sign_in.agent and x.own) then raise exception 'appsAgentNotOwn' using errcode='42501'; end if;
 delete from public.company_app_sign_ins s where s.started_by=auth.uid() and s.app=app_key and s.finished_at is null;
 insert into public.company_app_sign_ins(company_id,app,flow_id,started_by,agent_id) values (c,app_key,flow,auth.uid(),start_app_sign_in.agent);
end $$;
revoke all on function public.start_app_sign_in(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.start_app_sign_in(uuid,text,text,uuid) to authenticated;

-- 20261222000000's, but the connect is logged with the sign-in's Agent.
create or replace function public.finish_app_sign_in(app_key text, flow text) returns table(company_id uuid, slug text)
language plpgsql security definer set search_path='' as $$
declare pending public.company_app_sign_ins;
begin
 select * into pending from public.company_app_sign_ins s where s.app=app_key and s.flow_id=flow and s.started_by=auth.uid() and s.finished_at is null for update;
 if pending.id is null then return; end if;
 if not public.is_company_owner(pending.company_id) then raise exception 'appsNotAllowed' using errcode='42501'; end if;
 update public.company_app_sign_ins s set finished_at=now() where s.id=pending.id;
 insert into public.company_audit(company_id,actor_id,action,app,agent_id) values (pending.company_id,auth.uid(),'app_connected',pending.app,pending.agent_id);
 return query select pending.company_id,(select c.slug from public.companies c where c.id=pending.company_id);
end $$;

-- The Engine removed the app from one Agent's own profile.
create function public.record_app_disconnected(c uuid, app_key text, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'appsNotAllowed' using errcode='42501'; end if;
 if coalesce(app_key,'') !~ '^[a-z][a-z0-9-]{0,63}$' then raise exception 'appsInvalid' using errcode='22023'; end if;
 if not exists(select 1 from public.company_app_agents(c) x where x.agent=record_app_disconnected.agent and x.own) then raise exception 'appsAgentNotOwn' using errcode='42501'; end if;
 insert into public.company_audit(company_id,actor_id,action,app,agent_id) values (c,auth.uid(),'app_disconnected',app_key,record_app_disconnected.agent);
end $$;
revoke all on function public.record_app_disconnected(uuid,text,uuid) from public,anon,service_role;
grant execute on function public.record_app_disconnected(uuid,text,uuid) to authenticated;

-- 20270109000000's, but an app's row names its Agent as it was called then, as an Agent's rule rows keep it.
create or replace function public.log_company_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),(select name from public.people where id=new.actor_id),
   'company',new.action,case when new.action='agent_level_changed' then jsonb_build_object('old_level',new.old_level,'new_level',new.new_level)
    when new.action='company_knowledge_changed' then jsonb_build_object('part',new.knowledge_part,'cleared',new.knowledge_cleared)
    when new.action in ('app_connected','app_disconnected') then jsonb_build_object('app',new.app)
     ||case when new.agent_id is null then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object('agent_name',(select a.name from public.hermes_agents a where a.id=new.agent_id))) end
    when new.action in ('subscription_connected','subscription_disconnected','provider_key_set','provider_key_removed') then jsonb_build_object('provider',new.provider)
    else jsonb_build_object('old_name',new.old_name,'new_name',new.new_name) end,'company_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_company_change() from public,anon,authenticated,service_role;
