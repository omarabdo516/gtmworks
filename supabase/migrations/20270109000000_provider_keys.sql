-- #124, ADR 0016: an Owner gives a Company's model-provider API key once, and gtmworks passes it straight to the
-- bundled Engine for the Company's shared space and each of its Agent profiles (lib/provider-keys.mjs). The key is never
-- kept here. The database names which Engine profiles are the Company's, so a key reaches those and no other Company's,
-- and keeps each set and removal in company_audit by the provider's name, copied into the log.
--
-- Nothing existing is rewritten: the audit constraints only gain a branch for the two new actions, which no old row
-- holds, and log_company_change copies them as it copies a subscription change. The previous app version never calls
-- the two new functions and runs against this database unchanged.

-- The Company's profiles in its bundled Engine, each with the Agent it serves: the shared space once it is made, the
-- Company's own profile with the Agent that keeps it, and every Agent profile recorded for the Company. Members only.
create function public.company_key_profiles(c uuid) returns table(profile text, kind text, agent uuid, name text)
language sql stable security definer set search_path='' as $$
 select x.profile,x.kind,x.agent,x.name from (
  select s.profile,'space' as kind,null::uuid as agent,null::text as name,0 as rank from public.company_shared_spaces s where s.company_id=c
  union all
  select p.profile,'company',k.id,k.name,1 from public.company_profiles p
   left join public.hermes_agents k on k.company_id=c and k.id=public.company_profile_keeper(c) where p.company_id=c
  union all
  select a.profile,'agent',a.agent_id,g.name,2 from public.agent_profiles a
   left join public.hermes_agents g on g.company_id=c and g.id=a.agent_id where a.company_id=c
 ) x
 where public.is_member(c) and exists(select 1 from public.company_profiles p join public.hermes_connections h on h.company_id=p.company_id
  where p.company_id=c and public.is_bundled_connection(h.id))
 order by x.rank,x.profile;
$$;
revoke all on function public.company_key_profiles(uuid) from public,anon,service_role;
grant execute on function public.company_key_profiles(uuid) to authenticated;

alter table public.company_audit drop constraint company_audit_action_check;
alter table public.company_audit add constraint company_audit_action_check check (action in ('company_renamed','agent_level_changed','company_knowledge_changed','app_connected','app_disconnected','subscription_connected','subscription_disconnected','provider_key_set','provider_key_removed'));
alter table public.company_audit drop constraint company_audit_values;
alter table public.company_audit add constraint company_audit_values check (
 (action='company_renamed' and old_name is not null and new_name is not null)
 or (action='agent_level_changed' and old_level between 1 and 3 and new_level between 1 and 3)
 or (action='company_knowledge_changed' and knowledge_part is not null and knowledge_cleared is not null)
 or (action in ('app_connected','app_disconnected') and app is not null)
 or (action in ('subscription_connected','subscription_disconnected') and provider in ('openai-codex','anthropic'))
 or (action in ('provider_key_set','provider_key_removed') and provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'));

-- 20270104000000's, unchanged but for the two key actions beside the subscription's.
create or replace function public.log_company_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),(select name from public.people where id=new.actor_id),
   'company',new.action,case when new.action='agent_level_changed' then jsonb_build_object('old_level',new.old_level,'new_level',new.new_level)
    when new.action='company_knowledge_changed' then jsonb_build_object('part',new.knowledge_part,'cleared',new.knowledge_cleared)
    when new.action in ('app_connected','app_disconnected') then jsonb_build_object('app',new.app)
    when new.action in ('subscription_connected','subscription_disconnected','provider_key_set','provider_key_removed') then jsonb_build_object('provider',new.provider)
    else jsonb_build_object('old_name',new.old_name,'new_name',new.new_name) end,'company_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_company_change() from public,anon,authenticated,service_role;

-- The Engine took a key, or let one go, for the provider. Only the Company's Owner records it; the key is never given.
create function public.record_provider_key_change(c uuid, provider text, present boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'keyNotAllowed' using errcode='42501'; end if;
 if coalesce(provider,'') !~ '^[a-z0-9][a-z0-9._-]{0,63}$' or present is null then raise exception 'keyInvalid' using errcode='22023'; end if;
 insert into public.company_audit(company_id,actor_id,action,provider)
  values (c,auth.uid(),case when present then 'provider_key_set' else 'provider_key_removed' end,provider);
end $$;
revoke all on function public.record_provider_key_change(uuid,text,boolean) from public,anon,service_role;
grant execute on function public.record_provider_key_change(uuid,text,boolean) to authenticated;

-- The Company's profiles the last set or removal of a provider's key did not reach. The Engine says only whether a
-- profile holds a key, so a profile that kept the old key through a failed rotation reads the same as one that took the
-- new one: the Owner sees it here until a later change reaches it. Profile names only, never a key.
create table public.company_key_unfinished (
 company_id uuid not null references public.companies(id) on delete cascade,
 provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
 profiles text[] not null check (cardinality(profiles)>0),
 primary key (company_id,provider)
);
alter table public.company_key_unfinished enable row level security;
revoke all on public.company_key_unfinished from anon,authenticated,service_role;

-- The Owner records which of the Company's own profiles a change missed; none clears the provider's row.
create function public.record_unfinished_provider_key(c uuid, key_provider text, missed text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'keyNotAllowed' using errcode='42501'; end if;
 if coalesce(key_provider,'') !~ '^[a-z0-9][a-z0-9._-]{0,63}$' or missed is null
  or exists(select 1 from unnest(missed) m where m is null or m not in (select k.profile from public.company_key_profiles(c) k where k.kind<>'space')) then
  raise exception 'keyInvalid' using errcode='22023';
 end if;
 if cardinality(missed)=0 then
  delete from public.company_key_unfinished u where u.company_id=c and u.provider=key_provider;
 else
  insert into public.company_key_unfinished(company_id,provider,profiles) values (c,key_provider,missed)
   on conflict (company_id,provider) do update set profiles=excluded.profiles;
 end if;
end $$;
revoke all on function public.record_unfinished_provider_key(uuid,text,text[]) from public,anon,service_role;
grant execute on function public.record_unfinished_provider_key(uuid,text,text[]) to authenticated;

create function public.company_key_unfinished_profiles(c uuid) returns table(provider text, profiles text[])
language sql stable security definer set search_path='' as $$
 select u.provider,u.profiles from public.company_key_unfinished u where u.company_id=c and public.is_company_owner(c) order by u.provider;
$$;
revoke all on function public.company_key_unfinished_profiles(uuid) from public,anon,service_role;
grant execute on function public.company_key_unfinished_profiles(uuid) to authenticated;
