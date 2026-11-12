-- Each install belongs to the person who runs it, so nobody outside a Company's Members enters it (ADR 0012, #7).
-- The Agency bypass is removed: no policy or function grants access because a person is Agency staff, and what only the
-- Agency could do (Hermes Connections, the Company's agents, the record_conversation_* writes, the shared Engine notice,
-- usage) belongs to the Company's Owner, with no two-step requirement. The reviewer Role is removed: its Members and
-- invitations become Contributors. Contributors never approve (role_permissions, ADR 0006), so an approval step addressed
-- to reviewers, or to one person who was a reviewer, is addressed to the Company's Managers; reviewer permission rows go.
-- The previous app version's Agency screens and Agency-only calls refuse from here on; its other screens keep working.

-- An active Owner of the Company: the one check every former Agency-only action now makes.
create or replace function public.is_company_owner(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members where company_id=c and person_id=auth.uid() and removed_at is null and role='owner');
$$;
revoke all on function public.is_company_owner(uuid) from public,anon,service_role;
grant execute on function public.is_company_owner(uuid) to authenticated;

create or replace function public.can_manage_company(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.members where company_id=target and person_id=auth.uid() and removed_at is null and role in ('owner','manager'));
$$;
create or replace function public.can_assign_owner(target uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select public.is_company_owner(target);
$$;
create or replace function public.work_can_edit(c uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.members where company_id=c and person_id=auth.uid() and removed_at is null and role in ('owner','manager','contributor')); $$;

-- Reads: a Member of the Company, never anyone else.
drop policy if exists company_agency_read on public.companies;
drop policy if exists member_agency_read on public.members;
alter policy people_team_read on public.people using (exists(select 1 from public.members m where m.person_id=people.id and public.is_member(m.company_id)));
alter policy audit_read on public.member_audit using (public.is_member(company_id));
do $$ declare t text; begin foreach t in array array['work_stages','work_labels','work_cards','work_checklist','work_card_labels','work_assignees','work_creatives','work_versions','work_comments','work_activity','work_projects'] loop execute format('alter policy work_read on public.%I using (public.is_member(company_id))',t); end loop; end $$;
alter policy creative_read on storage.objects using (bucket_id='creatives' and public.is_member(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then (storage.foldername(name))[1]::uuid end));
alter policy approval_steps_read on public.approval_steps using (public.is_member(company_id));
alter policy card_visits_read on public.work_card_visits using (person_id=auth.uid() and public.is_member(company_id));
alter policy card_visits_insert on public.work_card_visits with check (person_id=auth.uid() and public.is_member(company_id));
alter policy card_visits_update on public.work_card_visits using (person_id=auth.uid() and public.is_member(company_id)) with check (person_id=auth.uid() and public.is_member(company_id));
alter policy agent_requests_read on public.agent_requests using (person_id=auth.uid() and public.is_member(company_id));
alter policy agent_requests_insert on public.agent_requests with check (person_id=auth.uid() and public.is_member(company_id));
alter policy attachments_read on public.work_attachments using (public.is_member(company_id) and (auth.jwt()->>'run_card' is null or card_id=(auth.jwt()->>'run_card')::bigint));
alter policy skills_read on public.skills using (public.is_member(company_id));
alter policy skill_versions_read on public.skill_versions using (public.is_member(company_id));
alter policy skill_enablements_read on public.skill_enablements using (public.is_member(company_id));
alter policy skill_events_read on public.skill_events using (public.is_member(company_id));
alter policy skill_loads_read on public.skill_loads using (public.is_member(company_id));
alter policy skill_lessons_read on public.skill_lessons using (public.is_member(company_id));
alter policy hermes_agents_read on public.hermes_agents using (public.is_member(company_id));
alter policy hermes_agent_audit_read on public.hermes_agent_audit using (public.is_member(company_id));
alter policy conversations_read on public.conversations using (person_id=auth.uid() and public.is_member(company_id));
alter policy conversation_messages_read on public.conversation_messages using (exists(select 1 from public.conversations c where c.id=conversation_id and c.company_id=conversation_messages.company_id and c.person_id=auth.uid() and public.is_member(c.company_id)));
alter policy conversation_usage_read on public.conversation_usage using (exists(select 1 from public.conversations c where c.id=conversation_id and c.company_id=conversation_usage.company_id and c.person_id=auth.uid() and public.is_member(c.company_id)));

create or replace function public.company_agents(c uuid) returns table(person_id uuid, role text, granted boolean) language sql stable security definer set search_path='' as $$
 select a.id, a.role, exists(select 1 from public.agent_grants g join public.members m on m.company_id=g.company_id and m.person_id=g.agent_id and m.removed_at is null where g.company_id=c and g.agent_id=a.id and g.revoked_at is null)
 from public.agents a where public.is_member(c);
$$;

-- Anyone on the team may install; an agent may not. A refused skill is not stored and the reasons come back.
create or replace function public.install_skill(c uuid, src text, body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare parsed jsonb := public.skill_parse(body); sk public.skills%rowtype; digest text := encode(sha256(convert_to(body,'UTF8')),'hex'); latest public.skill_versions%rowtype; next_version integer;
begin
 if auth.uid() is null or not public.is_member(c) or exists(select 1 from public.agents where id=auth.uid()) then raise exception 'not permitted to install skills' using errcode='42501'; end if;
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
create or replace function public.set_skill_enabled(c uuid, s uuid, a uuid, enable boolean) returns void language plpgsql security definer set search_path='' as $$
declare sk public.skills%rowtype;
begin
 if auth.uid() is null or not public.is_member(c) or exists(select 1 from public.agents where id=auth.uid()) then raise exception 'not permitted to enable skills' using errcode='42501'; end if;
 select * into sk from public.skills where company_id=c and id=s;
 if not found then raise exception 'skill not found'; end if;
 if not exists(select 1 from public.agent_grants g where g.company_id=c and g.agent_id=a and g.revoked_at is null) then raise exception 'agent not found'; end if;
 if enable then insert into public.skill_enablements(company_id,skill_id,agent_id,enabled_by) values (c,s,a,auth.uid()) on conflict do nothing;
 else delete from public.skill_enablements where skill_id=s and agent_id=a; end if;
 insert into public.skill_events(company_id,actor_id,actor_name,action,skill_id,slug,agent_id) values (c,auth.uid(),(select name from public.people where id=auth.uid()),case when enable then 'enable' else 'disable' end,s,sk.slug,a);
end $$;

-- The agents a skill can be enabled for are the shared agents holding an active grant in this company, whatever their member designation says.
create or replace function public.skill_agents(c uuid) returns table(agent_id uuid, role text) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_member(c) then raise exception 'not permitted' using errcode='42501'; end if;
 return query select g.agent_id, a.role from public.agent_grants g join public.agents a on a.id=g.agent_id where g.company_id=c and g.revoked_at is null order by a.role;
end $$;

-- Hermes Connections belong to the Company and are managed by its Owners. owner_id is the Owner who made the Connection.
alter table public.hermes_connections rename column agency_owner_id to owner_id;
alter policy hermes_read on public.hermes_connections using (public.is_company_owner(company_id));
alter policy hermes_create on public.hermes_connections with check (public.is_company_owner(company_id) and owner_id=auth.uid());
alter policy hermes_replace on public.hermes_connections using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));
alter policy hermes_remove on public.hermes_connections using (public.is_company_owner(company_id));

-- The Company's Owner manages its agents. A Connection is attached only by an Owner of the Company it was made in, so an
-- Owner of two Companies may still share one profile between them (the sharing warning is unchanged).
create or replace function public.manage_hermes_agent(c uuid, intent text, connection uuid default null, a uuid default null, agent_name text default null, speciality text default null, make_default boolean default false, confirm_sharing boolean default false, replacement uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare linked public.hermes_connections; current_agent public.hermes_agents; shared boolean; saved uuid; actor text; applied_replacement uuid;
begin
 if auth.uid() is null or not public.is_company_owner(c) then raise exception 'hermesNotAllowed' using errcode='42501'; end if;
 -- This install has few assignment writes; one lock serializes profile sharing and company defaults together.
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 if not exists(select 1 from public.companies where id=c) then raise exception 'hermesAgentNotFound' using errcode='P0002'; end if;
 if intent='attach' then
  select * into linked from public.hermes_connections where id=connection and public.is_company_owner(company_id);
  if not found then raise exception 'hermesAgentNotFound' using errcode='P0002'; end if;
  if linked.state<>'connected' or public.hermes_profile_address(linked.address) is null then raise exception 'hermesAgentFailed'; end if;
  select exists(select 1 from public.hermes_agents h join public.hermes_connections k on k.id=h.connection_id where h.company_id<>c and public.hermes_profile_address(k.address)=public.hermes_profile_address(linked.address) and k.profile=linked.profile) into shared;
  if shared and not coalesce(confirm_sharing,false) then raise exception 'hermesSharingWarning'; end if;
  if make_default then update public.hermes_agents set is_default=false where company_id=c and is_default; end if;
  insert into public.hermes_agents(company_id,connection_id,name,speciality,is_default)
   values(c,connection,trim(agent_name),trim(speciality),coalesce(make_default,false) or not exists(select 1 from public.hermes_agents where company_id=c)) returning id into saved;
 else
  select * into current_agent from public.hermes_agents where id=a and company_id=c;
  select * into linked from public.hermes_connections where id=current_agent.connection_id;
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

-- Conversations: any Member except a Viewer talks to the company's agents; every sender's run id is checked.
create or replace function public.conversation_can_write(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.members where company_id=c and person_id=auth.uid() and removed_at is null and role<>'viewer');
$$;

create or replace function public.send_conversation_message(conversation uuid, c uuid, agent uuid, message text, message_key uuid, run text)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.conversations; chosen public.hermes_agents; writer text; saved bigint;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into chosen from public.hermes_agents where id=agent and company_id=c;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),agent,chosen.name) on conflict (id) do nothing;
 select * into existing from public.conversations where id=conversation;
 if existing.person_id<>auth.uid() or existing.company_id<>c or existing.agent_id is distinct from agent then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 -- A Member cannot register a run that belongs to another conversation: each copy would be closed again and its
 -- engine usage counted twice. The lock keeps two calls at once from both passing. A retry in the same conversation
 -- stays idempotent.
 perform pg_advisory_xact_lock(hashtextextended('conversation_run:'||coalesce(run,''),0));
 if exists(select 1 from public.conversation_messages where author='person' and run_id=run and conversation_id<>conversation) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select name into writer from public.people where id=auth.uid();
 insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
  values(c,conversation,'person',auth.uid(),coalesce(writer,''),message,message_key,run) on conflict do nothing returning id into saved;
 return saved is not null;
end;
$$;

-- The previous app version's direct writes: only the conversation's own person, while an Owner of its Company.
create or replace function public.record_conversation_reply(conversation uuid, run text, reply text, hermes_session text) returns void language plpgsql security definer set search_path='' as $$
declare existing public.conversations;
begin
 if auth.uid() is null then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into existing from public.conversations where id=conversation and person_id=auth.uid();
 if found and not public.is_company_owner(existing.company_id) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if not found or not exists(select 1 from public.conversation_messages where conversation_id=conversation and author='person' and run_id=run) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
  values(existing.company_id,conversation,'agent',existing.agent_id,existing.agent_name,left(reply,200000),run) on conflict do nothing;
 update public.conversations set hermes_session_id=hermes_session where id=conversation and hermes_session_id is null and hermes_session is not null;
end;
$$;

create or replace function public.record_conversation_run(conversation uuid, run text, run_outcome text, reply text, hermes_session text, used_input bigint, used_output bigint)
returns void language plpgsql security definer set search_path='' as $$
declare existing public.conversations; known boolean := used_input is not null and used_output is not null;
begin
 if auth.uid() is null then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into existing from public.conversations where id=conversation and person_id=auth.uid();
 if found and not public.is_company_owner(existing.company_id) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if not found or not exists(select 1 from public.conversation_messages where conversation_id=conversation and author='person' and run_id=run) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if run_outcome not in ('completed','stopped','lost','failed') or run_outcome='completed' and coalesce(trim(reply),'')='' then raise exception 'conversationFailed' using errcode='22023'; end if;
 -- Usage first: the reply's own trigger then finds the run already recorded with what Hermes reported.
 insert into public.conversation_usage(company_id,conversation_id,run_id,outcome,input_tokens,output_tokens)
  values(existing.company_id,conversation,run,run_outcome,case when known then used_input end,case when known then used_output end) on conflict do nothing;
 if run_outcome='completed' then
  insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
   values(existing.company_id,conversation,'agent',existing.agent_id,existing.agent_name,left(reply,200000),run) on conflict do nothing;
  update public.conversations set hermes_session_id=hermes_session where id=conversation and hermes_session_id is null and hermes_session is not null;
 end if;
end;
$$;

-- Tokens per company per day (UTC): an Owner sees the companies they own; everyone else sees nothing.
create or replace function public.usage_by_day() returns table(company_id uuid, company_name text, day date, input_tokens bigint, output_tokens bigint, runs bigint, unknown_runs bigint)
language sql stable security definer set search_path='' as $$
 select u.company_id, co.name, (u.recorded_at at time zone 'UTC')::date, coalesce(sum(u.input_tokens),0)::bigint, coalesce(sum(u.output_tokens),0)::bigint, count(*), count(*) filter (where u.input_tokens is null)
 from public.conversation_usage u join public.companies co on co.id=u.company_id
 where auth.uid() is not null and public.is_company_owner(u.company_id)
 group by u.company_id, co.name, (u.recorded_at at time zone 'UTC')::date
 order by 3 desc, 2;
$$;

-- The shared Engine notice is for the Company's Owner (ADR 0010).
create or replace function public.bundled_engine_shared(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_company_owner(c)
  and exists(select 1 from (select distinct h.address,h.profile from public.hermes_agent_audit u join public.hermes_connections h on h.id=(u.details->>'connection_id')::uuid
    where u.action='PROVIDE_BUNDLED_HERMES_AGENT') b
   join public.hermes_connections h on h.address=b.address and h.profile=b.profile join public.hermes_agents a on a.connection_id=h.id
   group by b.address,b.profile having bool_or(a.company_id=c) and count(distinct a.company_id)>1);
$$;

-- The first person is the first Company's Owner; nobody else is created.
create or replace function public.complete_setup(person uuid, person_name text, company_name text, language text) returns text language plpgsql security definer set search_path='' as $$
declare company uuid:=gen_random_uuid(); slug text;
begin
 perform pg_advisory_xact_lock(238, 1);
 if not public.setup_is_open() then raise exception 'Setup closed'; end if;
 if length(trim(person_name)) not between 1 and 120 or length(trim(company_name)) not between 1 and 120 or language not in ('en','ar') or person_name is null or company_name is null or language is null then raise exception 'Invalid setup'; end if;
 slug:=coalesce(nullif(trim(both '-' from regexp_replace(lower(company_name),'[^a-z0-9]+','-','g')),''),'company') || '-' || left(company::text,8);
 insert into public.people(id,name,language) values(person,person_name,language);
 insert into public.companies(id,slug,name) values(company,slug,company_name);
 insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) values(company,person,'owner',true,true,true);
 update public.setup_claim set closed=true where singleton;
 return slug;
end $$;

-- The bundled Hermes (ADR 0010) is given to a company with no Connection or agent once it has an Owner; the Connection
-- is the Company's, made in the name of its first Owner.
create or replace function public.bundled_hermes_waiting() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.companies c
  where not exists(select 1 from public.hermes_connections h where h.company_id=c.id)
   and not exists(select 1 from public.hermes_agents a where a.company_id=c.id)
   and exists(select 1 from public.members m where m.company_id=c.id and m.role='owner' and m.removed_at is null));
$$;

create or replace function public.provide_bundled_hermes(bundled_address text, bundled_profile text, bundled_key text, bundled_version text, bundled_features text[])
returns integer language plpgsql security definer set search_path='' as $$
declare target uuid; first_owner uuid; linked uuid; agent uuid; provided integer:=0;
begin
 if public.hermes_profile_address(bundled_address) is null or coalesce(bundled_profile,'') !~ '^[a-zA-Z0-9_-]{1,100}$' or coalesce(bundled_key,'')=''
  or not ('run_submission'=any(coalesce(bundled_features,'{}'))) then raise exception 'hermesAgentFailed' using errcode='22023'; end if;
 -- The same lock as agent assignments: a company is provided once, even with a second worker.
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 for target in select c.id from public.companies c
  where not exists(select 1 from public.hermes_connections h where h.company_id=c.id)
   and not exists(select 1 from public.hermes_agents a where a.company_id=c.id) order by c.id loop
  select m.person_id into first_owner from public.members m where m.company_id=target and m.role='owner' and m.removed_at is null order by m.person_id limit 1;
  continue when first_owner is null;
  insert into public.hermes_connections(company_id,owner_id,address,profile,key_encrypted,state,version,features)
   values(target,first_owner,bundled_address,bundled_profile,bundled_key,'connected',bundled_version,bundled_features) returning id into linked;
  insert into public.hermes_agents(company_id,connection_id,name,speciality,is_default) values(target,linked,'Lead','General',true) returning id into agent;
  insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
   values(target,first_owner,(select name from public.people where id=first_owner),agent,'PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id',linked));
  provided:=provided+1;
 end loop;
 return provided;
end;
$$;

drop function if exists public.agency_access();
drop function if exists public.is_agency_owner();
alter table public.people drop column if exists agency_owner;

-- The reviewer Role. Steps first, while the people who were reviewers can still be told apart.
create temporary table former_reviewer_steps as
 select s.id from public.approval_steps s where s.role='reviewer'
  or (s.removed_at is null and exists(select 1 from public.members m where m.company_id=s.company_id and m.person_id=s.person_id and m.role='reviewer'));
update public.approval_steps set person_id=null, role='manager' where id in (select id from former_reviewer_steps);
update public.members set role='contributor' where role='reviewer';
update public.member_invitations set role='contributor' where role='reviewer';
delete from public.role_permissions where role='reviewer';

-- Rebuild the type without reviewer. A column used in a policy cannot change type, so those policies are dropped and
-- created again unchanged; the step check names the approver Roles that remain.
drop policy if exists agent_keys_owner_read on public.agent_keys;
drop policy if exists agent_keys_owner_create on public.agent_keys;
drop policy if exists agent_keys_owner_update on public.agent_keys;
drop policy if exists agent_refusals_owner_read on public.agent_refusals;
drop policy if exists agent_webhooks_owner on public.agent_webhooks;
drop policy if exists webhook_deliveries_owner_read on public.webhook_deliveries;
drop policy if exists invitation_insert on public.member_invitations;
drop policy if exists invitation_update on public.member_invitations;
do $$ declare k name; begin for k in select conname from pg_constraint where conrelid='public.approval_steps'::regclass and contype='c' and pg_get_constraintdef(oid) like '%reviewer%' loop execute format('alter table public.approval_steps drop constraint %I',k); end loop; end $$;
alter type public.member_role rename to member_role_with_reviewer;
create type public.member_role as enum ('owner', 'manager', 'contributor', 'viewer');
alter table public.members alter column role type public.member_role using role::text::public.member_role;
alter table public.member_invitations alter column role type public.member_role using role::text::public.member_role;
alter table public.role_permissions alter column role type public.member_role using role::text::public.member_role;
alter table public.approval_steps alter column role type public.member_role using role::text::public.member_role;
alter table public.approval_steps add constraint approval_steps_approver_role check (role is null or role in ('owner','manager'));
drop function public.save_approval_step(uuid,bigint,text,integer,uuid,public.member_role_with_reviewer);
drop type public.member_role_with_reviewer;

create policy agent_keys_owner_read on public.agent_keys for select to authenticated using (kind='agent' and exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));
create policy agent_keys_owner_create on public.agent_keys for insert to authenticated with check (kind='agent' and exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null) and exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=agent_keys.person_id and m.role='contributor' and m.removed_at is null));
create policy agent_keys_owner_update on public.agent_keys for update to authenticated using (kind='agent' and exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null)) with check (kind='agent' and exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));
create policy agent_refusals_owner_read on public.agent_refusals for select to authenticated using (exists(select 1 from public.members m where m.company_id=agent_refusals.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));
create policy agent_webhooks_owner on public.agent_webhooks for all to authenticated using (exists(select 1 from public.members m where m.company_id=agent_webhooks.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null)) with check (exists(select 1 from public.members m where m.company_id=agent_webhooks.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));
create policy webhook_deliveries_owner_read on public.webhook_deliveries for select to authenticated using (exists(select 1 from public.members m where m.company_id=webhook_deliveries.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));
create policy invitation_insert on public.member_invitations for insert to authenticated with check (public.can_manage_company(company_id) and (role <> 'owner' or public.can_assign_owner(company_id)));
create policy invitation_update on public.member_invitations for update to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id) and (role <> 'owner' or public.can_assign_owner(company_id)));

-- Approvers are Owners and Managers.
create or replace function public.approval_actor(c uuid, step bigint) returns uuid language sql stable security definer set search_path='' as $$
 select m.person_id from public.approval_steps s join public.members m on m.company_id=s.company_id and m.removed_at is null and m.role in ('owner','manager') and (m.person_id=s.person_id or (s.person_id is null and m.role=s.role)) where s.company_id=c and s.id=step and s.removed_at is null order by m.person_id limit 1 $$;
create or replace function public.approval_holds(c uuid, step bigint) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.approval_steps s join public.members m on m.company_id=s.company_id and m.person_id=auth.uid() and m.removed_at is null and m.role in ('owner','manager') and (m.person_id=s.person_id or (s.person_id is null and m.role=s.role)) where s.company_id=c and s.id=step and s.removed_at is null) $$;
create function public.save_approval_step(c uuid, step bigint, step_name text, step_position integer, member uuid, member_role public.member_role) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.can_manage_company(c) then raise exception 'not permitted'; end if;
 if member is not null and not exists(select 1 from public.members where company_id=c and person_id=member and removed_at is null and role in ('owner','manager')) then raise exception 'invalid approver'; end if;
 if step is null then insert into public.approval_steps(company_id,name,position,person_id,role) values(c,step_name,step_position,member,member_role);
 else update public.approval_steps set name=step_name,position=step_position,person_id=member,role=member_role where company_id=c and id=step and removed_at is null; if not found then raise exception 'step not found'; end if; perform set_config('approval.internal','yes',true); update public.work_cards set next_actor=public.approval_actor(c,step) where company_id=c and approval_step_id=step; perform set_config('approval.internal','',true); end if;
end $$;
revoke all on function public.save_approval_step(uuid,bigint,text,integer,uuid,public.member_role) from public,anon,service_role;
grant execute on function public.save_approval_step(uuid,bigint,text,integer,uuid,public.member_role) to authenticated;

-- A card waiting at a step whose approver was a reviewer now waits for the step's new approver.
do $$ begin
 perform set_config('approval.internal','yes',true);
 update public.work_cards set next_actor=public.approval_actor(company_id,approval_step_id)
  where approval_step_id in (select id from former_reviewer_steps) and next_actor is distinct from public.approval_actor(company_id,approval_step_id);
 perform set_config('approval.internal','',true);
end $$;
drop table former_reviewer_steps;
