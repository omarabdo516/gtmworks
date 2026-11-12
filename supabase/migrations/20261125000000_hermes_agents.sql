create table public.hermes_agents (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 connection_id uuid not null references public.hermes_connections(id),
 name text not null check (length(trim(name)) between 1 and 100),
 speciality text not null check (length(trim(speciality)) between 1 and 200),
 is_default boolean not null default false,
 unique(company_id,connection_id)
);
create unique index hermes_one_default on public.hermes_agents(company_id) where is_default;
alter table public.hermes_agents enable row level security;
create policy hermes_agents_read on public.hermes_agents for select to authenticated using (public.is_member(company_id) or public.agency_access());
revoke all on public.hermes_agents from anon,authenticated,service_role;
grant select on public.hermes_agents to authenticated;

create table public.hermes_agent_audit (
 id bigint generated always as identity primary key, company_id uuid not null references public.companies(id),
 actor_id uuid not null references public.people(id), actor_name text, agent_id uuid not null,
 action text not null, details jsonb not null, created_at timestamptz not null default now()
);
alter table public.hermes_agent_audit enable row level security;
create policy hermes_agent_audit_read on public.hermes_agent_audit for select to authenticated using (public.is_member(company_id) or public.agency_access());
revoke all on public.hermes_agent_audit from anon,authenticated,service_role;
grant select on public.hermes_agent_audit to authenticated;

-- Canonical URL identity; reject host spellings a URL parser would reinterpret.
create function public.hermes_profile_address(address text) returns text language plpgsql immutable set search_path='' as $$
declare parts text[]; hostname text; port integer; segment text; path text[]:='{}';
begin
 parts:=regexp_match(address,'^(https?)://(\[[0-9a-f:]+\]|[a-z0-9_.-]+)(:[0-9]{1,5})?(/[^?#]*)?$','i');
 if parts is null or address ~ '[[:space:]]' or position(chr(92) in address)>0 then return null; end if;
 hostname:=lower(parts[2]);
 if left(hostname,1)='[' then hostname:='['||host(trim(hostname,'[]')::inet)||']';
 elsif hostname ~ '(^|\.)([0-9]+|0x[0-9a-f]+)$' then
  if hostname !~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' or hostname<>host(hostname::inet) then return null; end if;
 end if;
 port:=substring(parts[3] from 2)::integer;
 if port>65535 then return null; end if;
 foreach segment in array string_to_array(coalesce(parts[4],''),'/') loop
  if regexp_replace(segment,'%2e','.','gi')='..' then
   if cardinality(path)>1 then path:=path[1:cardinality(path)-1]; end if;
  elsif regexp_replace(segment,'%2e','.','gi')<>'.' then path:=array_append(path,segment);
  end if;
 end loop;
 return lower(parts[1])||'://'||hostname||case when port is null or (lower(parts[1])='http' and port=80) or (lower(parts[1])='https' and port=443) then '' else ':'||port::text end||rtrim(array_to_string(path,'/'),'/');
exception when invalid_text_representation then return null;
end;
$$;
revoke all on function public.hermes_profile_address(text) from public,anon,authenticated,service_role;

create function public.manage_hermes_agent(c uuid, intent text, connection uuid default null, a uuid default null, agent_name text default null, speciality text default null, make_default boolean default false, confirm_sharing boolean default false, replacement uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare linked public.hermes_connections; current_agent public.hermes_agents; shared boolean; saved uuid; actor text; applied_replacement uuid;
begin
 if auth.uid() is null or not public.agency_access() then raise exception 'hermesAgencyOnly' using errcode='42501'; end if;
 -- This install has few assignment writes; one lock serializes profile sharing and company defaults together.
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if not exists(select 1 from public.companies where id=c) then raise exception 'hermesAgentNotFound' using errcode='P0002'; end if;
 if intent='attach' then
  select * into linked from public.hermes_connections where id=connection and agency_owner_id=auth.uid();
  if not found then raise exception 'hermesAgentNotFound' using errcode='P0002'; end if;
  if linked.state<>'connected' or public.hermes_profile_address(linked.address) is null then raise exception 'hermesAgentFailed'; end if;
  select exists(select 1 from public.hermes_agents h join public.hermes_connections k on k.id=h.connection_id where h.company_id<>c and public.hermes_profile_address(k.address)=public.hermes_profile_address(linked.address) and k.profile=linked.profile) into shared;
  if shared and not coalesce(confirm_sharing,false) then raise exception 'hermesSharingWarning'; end if;
  if make_default then update public.hermes_agents set is_default=false where company_id=c and is_default; end if;
  insert into public.hermes_agents(company_id,connection_id,name,speciality,is_default)
   values(c,connection,trim(agent_name),trim(speciality),coalesce(make_default,false) or not exists(select 1 from public.hermes_agents where company_id=c)) returning id into saved;
 else
  select * into current_agent from public.hermes_agents where id=a and company_id=c;
  select * into linked from public.hermes_connections where id=current_agent.connection_id and agency_owner_id=auth.uid();
  if current_agent.id is null or linked.id is null then raise exception 'hermesAgentNotFound' using errcode='P0002'; end if;
  saved:=a;
  if intent='default' then
   update public.hermes_agents set is_default=false where company_id=c and is_default;
   update public.hermes_agents set is_default=true where id=a;
  elsif intent='remove' then
   if current_agent.is_default and exists(select 1 from public.hermes_agents where company_id=c and id<>a) then
    if replacement is null or not exists(select 1 from public.hermes_agents where company_id=c and id=replacement and id<>a) then raise exception 'hermesNextDefault'; end if;
    update public.hermes_agents set is_default=false where id=a;
    update public.hermes_agents set is_default=true where id=replacement;
    applied_replacement:=replacement;
   end if;
   delete from public.hermes_agents where id=a;
  else raise exception 'hermesAgentFailed'; end if;
 end if;
 select name into actor from public.people where id=auth.uid();
 insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
  values(c,auth.uid(),actor,saved,upper(intent)||'_HERMES_AGENT',jsonb_build_object('connection_id',linked.id,'sharing_confirmed',coalesce(shared,false),'replacement_id',applied_replacement));
end;
$$;
revoke all on function public.manage_hermes_agent(uuid,text,uuid,uuid,text,text,boolean,boolean,uuid) from public,anon,service_role;
grant execute on function public.manage_hermes_agent(uuid,text,uuid,uuid,text,text,boolean,boolean,uuid) to authenticated;

-- Key replacement and status tests remain available; detach before changing a profile's identity.
create function public.guard_attached_hermes_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.address,new.profile) is distinct from (old.address,old.profile) then
  perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
  if exists(select 1 from public.hermes_agents where connection_id=old.id) then raise exception 'hermesProfileInUse'; end if;
 end if;
 return new;
end;
$$;
revoke all on function public.guard_attached_hermes_profile() from public,anon,authenticated,service_role;
create trigger hermes_profile_in_use before update on public.hermes_connections for each row execute function public.guard_attached_hermes_profile();
