-- #123, ADR 0016 (Sign-in): on an install with exactly one Company, the Owner signs a subscription in once on the
-- Engine's root profile, and the Engine gives it to every Agent profile with none of its own. The app learns here
-- whether the install has one Company and which Engine profiles are that Company's, so a Disconnect also removes an
-- older sign-in left in any of them and in no other Company's. On an install with several Companies the rule of
-- ADR 0014 stays. Each connect and disconnect of a subscription is kept in company_audit and copied into the log.
--
-- Nothing existing is rewritten: the two new audit columns are null on every old row. company_engine_target answers
-- two more columns; the previous app version reads only connection, address and profile from it, and runs against
-- this database unchanged.

create function public.install_has_one_company() returns boolean language sql stable security definer set search_path='' as $$
 select count(*)=1 from public.companies;
$$;
revoke all on function public.install_has_one_company() from public,anon,authenticated,service_role;

drop function public.company_engine_target(uuid);
create function public.company_engine_target(c uuid) returns table(connection uuid, address text, profile text, one_company boolean, profiles text[])
language sql stable security definer set search_path='' as $$
 select h.id,h.address,p.profile,public.install_has_one_company(),
  array_prepend(p.profile,array(select a.profile from public.agent_profiles a where a.company_id=c order by a.profile))
 from public.company_profiles p join public.hermes_connections h on h.company_id=p.company_id
 where p.company_id=c and public.is_member(c) and public.is_bundled_connection(h.id)
 order by h.profile=p.profile desc,h.id limit 1;
$$;
revoke all on function public.company_engine_target(uuid) from public,anon,service_role;
grant execute on function public.company_engine_target(uuid) to authenticated;

alter table public.company_audit add column provider text, add column sign_in_session text;
alter table public.company_audit drop constraint company_audit_action_check;
alter table public.company_audit add constraint company_audit_action_check check (action in ('company_renamed','agent_level_changed','company_knowledge_changed','app_connected','app_disconnected','subscription_connected','subscription_disconnected'));
alter table public.company_audit drop constraint company_audit_values;
alter table public.company_audit add constraint company_audit_values check (
 (action='company_renamed' and old_name is not null and new_name is not null)
 or (action='agent_level_changed' and old_level between 1 and 3 and new_level between 1 and 3)
 or (action='company_knowledge_changed' and knowledge_part is not null and knowledge_cleared is not null)
 or (action in ('app_connected','app_disconnected') and app is not null)
 or (action in ('subscription_connected','subscription_disconnected') and provider in ('openai-codex','anthropic')));
-- A sign-in the Engine finished is logged once, however often its last poll is answered.
create unique index company_audit_sign_in_session on public.company_audit(company_id,sign_in_session) where sign_in_session is not null;

create or replace function public.log_company_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),(select name from public.people where id=new.actor_id),
   'company',new.action,case when new.action='agent_level_changed' then jsonb_build_object('old_level',new.old_level,'new_level',new.new_level)
    when new.action='company_knowledge_changed' then jsonb_build_object('part',new.knowledge_part,'cleared',new.knowledge_cleared)
    when new.action in ('app_connected','app_disconnected') then jsonb_build_object('app',new.app)
    when new.action in ('subscription_connected','subscription_disconnected') then jsonb_build_object('provider',new.provider)
    else jsonb_build_object('old_name',new.old_name,'new_name',new.new_name) end,'company_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_company_change() from public,anon,authenticated,service_role;

-- The Engine finished a sign-in (with the session it ran under) or removed one. Only the Company's Owner records it.
create function public.record_subscription_change(c uuid, provider text, connected boolean, session text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'signInNotAllowed' using errcode='42501'; end if;
 if coalesce(provider,'') not in ('openai-codex','anthropic') or connected is null or session !~ '^[A-Za-z0-9_-]{8,128}$' then
  raise exception 'signInInvalid' using errcode='22023';
 end if;
 insert into public.company_audit(company_id,actor_id,action,provider,sign_in_session)
  values (c,auth.uid(),case when connected then 'subscription_connected' else 'subscription_disconnected' end,provider,session)
  on conflict (company_id,sign_in_session) where sign_in_session is not null do nothing;
end $$;
revoke all on function public.record_subscription_change(uuid,text,boolean,text) from public,anon,service_role;
grant execute on function public.record_subscription_change(uuid,text,boolean,text) to authenticated;
