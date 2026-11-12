-- Skills: SKILL.md instructions installed per company, enabled per agent, checked before they are stored.
-- Instructions come only from these rows; nothing on a card or in a message can add to them (ADR 0006).
create table public.skills (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'), source text not null check (source in ('library','upload','team')),
 installed_by uuid references public.people(id), installed_at timestamptz not null default now(),
 unique (company_id, id), unique (company_id, slug)
);
create table public.skill_versions (
 company_id uuid not null, skill_id uuid not null, version integer not null check (version > 0),
 name text not null, description text not null, permissions text[] not null, content text not null check (octet_length(content) <= 20000), sha256 text not null,
 created_by uuid references public.people(id), created_at timestamptz not null default now(),
 primary key (skill_id, version), foreign key (company_id, skill_id) references public.skills(company_id, id)
);
create table public.skill_enablements (
 company_id uuid not null, skill_id uuid not null, agent_id uuid not null references public.agents(id),
 enabled_by uuid references public.people(id), enabled_at timestamptz not null default now(),
 primary key (skill_id, agent_id), foreign key (company_id, skill_id) references public.skills(company_id, id)
);
-- Every install, enable and disable, with the person who did it.
create table public.skill_events (
 id bigint generated always as identity primary key, company_id uuid not null references public.companies(id),
 actor_id uuid references public.people(id), actor_name text, action text not null check (action in ('install','enable','disable')),
 skill_id uuid not null, slug text not null, version integer, agent_id uuid, created_at timestamptz not null default now()
);
-- The skill versions one run key (one run) loaded.
create table public.skill_loads (
 company_id uuid not null references public.companies(id), key_id uuid not null references public.agent_keys(id),
 skill_id uuid not null, slug text not null, version integer not null, sha256 text not null, loaded_at timestamptz not null default now(),
 primary key (key_id, skill_id, version), foreign key (skill_id, version) references public.skill_versions(skill_id, version)
);
alter table public.skills enable row level security;
alter table public.skill_versions enable row level security;
alter table public.skill_enablements enable row level security;
alter table public.skill_events enable row level security;
alter table public.skill_loads enable row level security;
create policy skills_read on public.skills for select to authenticated using (public.is_member(company_id) or public.agency_access());
create policy skill_versions_read on public.skill_versions for select to authenticated using (public.is_member(company_id) or public.agency_access());
create policy skill_enablements_read on public.skill_enablements for select to authenticated using (public.is_member(company_id) or public.agency_access());
create policy skill_events_read on public.skill_events for select to authenticated using (public.is_member(company_id) or public.agency_access());
create policy skill_loads_read on public.skill_loads for select to authenticated using (public.is_member(company_id) or public.agency_access());
-- Only the functions below change these tables; clients get read access only.
revoke all on public.skills, public.skill_versions, public.skill_enablements, public.skill_events, public.skill_loads from public, anon, authenticated;
grant select on public.skills, public.skill_versions, public.skill_enablements, public.skill_events, public.skill_loads to authenticated;

-- The automatic check. Reasons are codes the interface translates: no_frontmatter, too_large, install_script, bad_name, no_description, no_permissions, unknown_permission.
create function public.skill_parse(body text) returns jsonb language plpgsql immutable set search_path='' as $$
declare text_ text := replace(body, E'\r', ''); fm text; line text; problems text[] := '{}'; name_ text; descr text; raw text; perms text[] := '{}'; item text;
begin
 if octet_length(body) > 20000 then problems := array_append(problems, 'too_large'); end if;
 fm := substring(text_ from '^---\n(.*?)\n---(?:\n|$)');
 if fm is null then return jsonb_build_object('problems', to_jsonb(array_append(problems, 'no_frontmatter'))); end if;
 for line in select regexp_split_to_table(fm, E'\n') loop
  if lower(substring(line from '^\s*([A-Za-z_-]+)\s*:')) in ('install','preinstall','postinstall','setup','scripts','hooks') then problems := array_append(problems, 'install_script'); exit; end if;
 end loop;
 name_ := trim(both ' "''' from coalesce((regexp_match(fm, '(?:^|\n)name:[ \t]*([^\n]*)'))[1], ''));
 descr := trim(both ' "''' from coalesce((regexp_match(fm, '(?:^|\n)description:[ \t]*([^\n]*)'))[1], ''));
 raw := (regexp_match(fm, '(?:^|\n)permissions:[ \t]*([^\n]*)'))[1];
 if name_ !~ '^[a-z0-9][a-z0-9-]{0,63}$' then problems := array_append(problems, 'bad_name'); end if;
 if descr = '' or length(descr) > 1024 then problems := array_append(problems, 'no_description'); end if;
 if raw is null then problems := array_append(problems, 'no_permissions');
 else
  for item in select trim(both ' "''' from x) from unnest(string_to_array(trim(both '[] ' from raw), ',')) x loop
   if item in ('', 'none') then continue; end if;
   if item not in ('cards.read','cards.write','files.read','network') then problems := array_append(problems, 'unknown_permission'); exit; end if;
   perms := perms || item;
  end loop;
 end if;
 return jsonb_build_object('problems', to_jsonb(problems), 'name', name_, 'description', descr, 'permissions', to_jsonb(perms));
end $$;

-- Anyone on the team may install; an agent may not. A refused skill is not stored and the reasons come back.
create function public.install_skill(c uuid, src text, body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare parsed jsonb := public.skill_parse(body); sk public.skills%rowtype; digest text := encode(sha256(convert_to(body,'UTF8')),'hex'); latest public.skill_versions%rowtype; next_version integer;
begin
 if auth.uid() is null or not (public.is_member(c) or public.agency_access()) or exists(select 1 from public.agents where id=auth.uid()) then raise exception 'not permitted to install skills' using errcode='42501'; end if;
 if src not in ('library','upload','team') then raise exception 'invalid source'; end if;
 if jsonb_array_length(parsed->'problems') > 0 then return jsonb_build_object('refused', parsed->'problems'); end if;
 select * into sk from public.skills where company_id=c and slug=parsed->>'name';
 if not found then
  insert into public.skills(company_id,slug,source,installed_by) values (c,parsed->>'name',src,auth.uid()) returning * into sk;
 end if;
 select * into latest from public.skill_versions where skill_id=sk.id order by version desc limit 1;
 if found and latest.sha256=digest then return jsonb_build_object('id',sk.id,'version',latest.version); end if;
 next_version := coalesce(latest.version,0)+1;
 insert into public.skill_versions(company_id,skill_id,version,name,description,permissions,content,sha256,created_by)
  values (c,sk.id,next_version,parsed->>'name',parsed->>'description',array(select jsonb_array_elements_text(parsed->'permissions')),body,digest,auth.uid());
 insert into public.skill_events(company_id,actor_id,actor_name,action,skill_id,slug,version) values (c,auth.uid(),(select name from public.people where id=auth.uid()),'install',sk.id,sk.slug,next_version);
 return jsonb_build_object('id',sk.id,'version',next_version);
end $$;

-- A skill is enabled for one agent in one company, and only for an agent holding an active grant there.
create function public.set_skill_enabled(c uuid, s uuid, a uuid, enable boolean) returns void language plpgsql security definer set search_path='' as $$
declare sk public.skills%rowtype;
begin
 if auth.uid() is null or not (public.is_member(c) or public.agency_access()) or exists(select 1 from public.agents where id=auth.uid()) then raise exception 'not permitted to enable skills' using errcode='42501'; end if;
 select * into sk from public.skills where company_id=c and id=s;
 if not found then raise exception 'skill not found'; end if;
 if not exists(select 1 from public.agent_grants g where g.company_id=c and g.agent_id=a and g.revoked_at is null) then raise exception 'agent not found'; end if;
 if enable then insert into public.skill_enablements(company_id,skill_id,agent_id,enabled_by) values (c,s,a,auth.uid()) on conflict do nothing;
 else delete from public.skill_enablements where skill_id=s and agent_id=a; end if;
 insert into public.skill_events(company_id,actor_id,actor_name,action,skill_id,slug,agent_id) values (c,auth.uid(),(select name from public.people where id=auth.uid()),case when enable then 'enable' else 'disable' end,s,sk.slug,a);
end $$;

-- The agent reads its enabled skills (the latest stored version of each) and the read is recorded against its key.
create function public.agent_load_skills(c uuid, k uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 -- A load belongs to a run: the key must be a live run key of this agent, and the caller's token must name that key's card (so another run's key is refused). It does not outlive the agent's membership or its company grant, even when this function is called directly.
 if not exists(select 1 from public.agent_keys where id=k and company_id=c and person_id=auth.uid() and kind='run' and card_id is not distinct from (auth.jwt()->>'run_card')::bigint and revoked_at is null and expires_at>now())
  or not exists(select 1 from public.members m where m.company_id=c and m.person_id=auth.uid() and m.removed_at is null and m.role='contributor')
  or not exists(select 1 from public.agent_grants g where g.company_id=c and g.agent_id=auth.uid() and g.revoked_at is null) then raise exception 'not permitted' using errcode='42501'; end if;
 with enabled as (
  select s.id as sid, s.slug as sslug, v.version as sversion, v.name as sname, v.description as sdescription, v.permissions as spermissions, v.content as scontent, v.sha256 as ssha
  from public.skill_enablements e join public.skills s on s.id=e.skill_id and s.company_id=c
  join lateral (select * from public.skill_versions x where x.skill_id=s.id order by x.version desc limit 1) v on true
  where e.company_id=c and e.agent_id=auth.uid()
 ), recorded as (
  insert into public.skill_loads(company_id,key_id,skill_id,slug,version,sha256) select c,k,sid,sslug,sversion,ssha from enabled on conflict do nothing
 )
 select coalesce(jsonb_agg(jsonb_build_object('slug',sslug,'version',sversion,'name',sname,'description',sdescription,'permissions',to_jsonb(spermissions),'content',scontent,'sha256',ssha) order by sslug),'[]'::jsonb) into result from enabled;
 return result;
end $$;
-- The agents a skill can be enabled for are the shared agents holding an active grant in this company, whatever their member designation says.
create function public.skill_agents(c uuid) returns table(agent_id uuid, role text) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not (public.is_member(c) or public.agency_access()) then raise exception 'not permitted' using errcode='42501'; end if;
 return query select g.agent_id, a.role from public.agent_grants g join public.agents a on a.id=g.agent_id where g.company_id=c and g.revoked_at is null order by a.role;
end $$;
revoke all on function public.skill_parse(text) from public, anon, authenticated;
revoke all on function public.install_skill(uuid,text,text) from public, anon;
revoke all on function public.set_skill_enabled(uuid,uuid,uuid,boolean) from public, anon;
revoke all on function public.agent_load_skills(uuid,uuid) from public, anon;
grant execute on function public.install_skill(uuid,text,text) to authenticated;
grant execute on function public.set_skill_enabled(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function public.agent_load_skills(uuid,uuid) to authenticated;
revoke all on function public.skill_agents(uuid) from public, anon;
grant execute on function public.skill_agents(uuid) to authenticated;
