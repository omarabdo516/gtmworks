-- A self-hosted install ships Hermes inside (ADR 0010). The worker gives each company with no Hermes yet one Connection
-- to the bundled Hermes, owned by an Agency owner (one who owns the company first), and a default agent on it, so nobody
-- pastes an address or a key. The key arrives already encrypted (ADR 0008). A company that has any Connection or agent,
-- pasted or bundled, is left as it is; the bundled profile is shared by every company of the install (ADR 0010).

-- Whether a company is waiting for the bundled Hermes, so the worker tests Hermes only when there is work.
create function public.bundled_hermes_waiting() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.people where agency_owner) and exists(select 1 from public.companies c
  where not exists(select 1 from public.hermes_connections h where h.company_id=c.id)
   and not exists(select 1 from public.hermes_agents a where a.company_id=c.id));
$$;
revoke all on function public.bundled_hermes_waiting() from public,anon,authenticated;
grant execute on function public.bundled_hermes_waiting() to service_role;

create function public.provide_bundled_hermes(bundled_address text, bundled_profile text, bundled_key text, bundled_version text, bundled_features text[])
returns integer language plpgsql security definer set search_path='' as $$
declare target uuid; owner_id uuid; linked uuid; agent uuid; provided integer:=0;
begin
 if public.hermes_profile_address(bundled_address) is null or coalesce(bundled_profile,'') !~ '^[a-zA-Z0-9_-]{1,100}$' or coalesce(bundled_key,'')=''
  or not ('run_submission'=any(coalesce(bundled_features,'{}'))) then raise exception 'hermesAgentFailed' using errcode='22023'; end if;
 -- The same lock as agent assignments: a company is provided once, even with a second worker.
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 for target in select c.id from public.companies c
  where not exists(select 1 from public.hermes_connections h where h.company_id=c.id)
   and not exists(select 1 from public.hermes_agents a where a.company_id=c.id) order by c.id loop
  select p.id into owner_id from public.people p where p.agency_owner
   order by not exists(select 1 from public.members m where m.company_id=target and m.person_id=p.id and m.role='owner' and m.removed_at is null),p.id limit 1;
  exit when owner_id is null;
  insert into public.hermes_connections(company_id,agency_owner_id,address,profile,key_encrypted,state,version,features)
   values(target,owner_id,bundled_address,bundled_profile,bundled_key,'connected',bundled_version,bundled_features) returning id into linked;
  insert into public.hermes_agents(company_id,connection_id,name,speciality,is_default) values(target,linked,'Hermes','General',true) returning id into agent;
  insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
   values(target,owner_id,(select name from public.people where id=owner_id),agent,'PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id',linked));
  provided:=provided+1;
 end loop;
 return provided;
end;
$$;
revoke all on function public.provide_bundled_hermes(text,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.provide_bundled_hermes(text,text,text,text,text[]) to service_role;
