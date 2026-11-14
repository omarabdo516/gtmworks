-- One log for the Company (#11): every change in a Company, made by a Member, an Agent or gtmworks itself, on a Card,
-- a Member or an Agent, with when it happened. The Activity log page reads it newest first; a Card reads its own rows.
-- The existing records keep being written as before (the previous app version reads them): Card activity
-- (work_activity), Card comments (work_comments), Member changes (member_audit) and Agent changes (hermes_agent_audit).
-- Each new row there is copied into the log by a trigger, and every row already there is copied once below with its
-- original author and time. Nothing is moved out of the old tables and nothing in the log is ever deleted.
create table public.company_log (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 actor_id uuid,
 actor_kind text not null check (actor_kind in ('person','agent','system')),
 actor_name text,
 subject text not null check (subject in ('card','member','agent')),
 card_id bigint,
 person_id uuid,
 agent_id uuid,
 action text not null,
 details jsonb not null default '{}'::jsonb,
 body text,
 source text not null check (source in ('work_activity','work_comments','member_audit','hermes_agent_audit')),
 source_id bigint not null,
 created_at timestamptz not null,
 unique (source, source_id),
 check ((subject='card')=(card_id is not null)),
 check ((actor_kind='system')=(actor_id is null))
);
create index company_log_newest on public.company_log(company_id, created_at desc, id desc);
create index company_log_by_card on public.company_log(company_id, card_id, created_at desc) where card_id is not null;
alter table public.company_log enable row level security;
-- Every Member reads the log of their own Company; nobody reads another Company's.
create policy company_log_read on public.company_log for select to authenticated using (public.is_member(company_id));
-- Only the copying triggers below write rows; no Role, the service key included, may change or delete one.
revoke all on public.company_log from anon,authenticated,service_role;
grant select on public.company_log to authenticated;
create function public.refuse_log_change() returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'logIsPermanent' using errcode='42501';
end;
$$;
revoke all on function public.refuse_log_change() from public,anon,authenticated,service_role;
create trigger company_log_append_only before update or delete on public.company_log for each row execute function public.refuse_log_change();

-- Who made a change: nobody (gtmworks itself), an Agent (a role Agent, or a Member that is an Agent) or a person.
create function public.log_actor_kind(c uuid, actor uuid) returns text language sql stable security definer set search_path='' as $$
 select case
  when actor is null then 'system'
  when exists(select 1 from public.agents a where a.id=actor)
   or exists(select 1 from public.members m where m.company_id=c and m.person_id=actor and m.agent_role is not null) then 'agent'
  else 'person' end;
$$;
revoke all on function public.log_actor_kind(uuid,uuid) from public,anon,authenticated,service_role;

-- A Member change keeps the Member's name, the Role before and after, and which settings changed.
create function public.log_member_details(person_name text, before_data jsonb, after_data jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object(
  'person_name',person_name,
  'old_role',before_data->>'role',
  'new_role',after_data->>'role',
  'agent_role',coalesce(after_data->>'agent_role',before_data->>'agent_role'),
  'changed',case when before_data is not null and after_data is not null then
   (select coalesce(jsonb_agg(k order by k),'[]'::jsonb) from jsonb_object_keys(after_data) k where before_data->k is distinct from after_data->k) end));
$$;
revoke all on function public.log_member_details(text,jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.log_member_action(action text) returns text language sql immutable set search_path='' as $$
 select case action when 'INSERT' then 'member_added' when 'UPDATE' then 'member_changed' when 'DELETE' then 'member_removed'
  when 'GRANT_AGENT' then 'agent_granted' when 'REVOKE_AGENT' then 'agent_revoked' else lower(action) end;
$$;
revoke all on function public.log_member_action(text) from public,anon,authenticated,service_role;

create function public.log_agent_action(action text) returns text language sql immutable set search_path='' as $$
 select case action when 'ATTACH_HERMES_AGENT' then 'agent_added' when 'DEFAULT_HERMES_AGENT' then 'agent_made_main'
  when 'REMOVE_HERMES_AGENT' then 'agent_removed' when 'PROVIDE_BUNDLED_HERMES_AGENT' then 'agent_provided' else lower(action) end;
$$;
revoke all on function public.log_agent_action(text) from public,anon,authenticated,service_role;

-- The copying triggers. A comment is logged once, as a note with its text, from work_comments; the matching
-- "comment_added" activity row is not copied a second time.
create function public.log_card_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),(select name from public.people where id=new.actor_id),
   'card',new.card_id,new.action,new.details,'work_activity',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_card_activity() from public,anon,authenticated,service_role;
create trigger work_activity_company_log after insert on public.work_activity for each row when (new.action<>'comment_added') execute function public.log_card_activity();

create function public.log_card_comment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,action,body,source,source_id,created_at)
  values(new.company_id,new.author_id,public.log_actor_kind(new.company_id,new.author_id),(select name from public.people where id=new.author_id),
   'card',new.card_id,'note',new.body,'work_comments',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_card_comment() from public,anon,authenticated,service_role;
create trigger work_comments_company_log after insert on public.work_comments for each row execute function public.log_card_comment();

create function public.log_member_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,person_id,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),coalesce(new.actor_name,(select name from public.people where id=new.actor_id)),
   'member',new.person_id,public.log_member_action(new.action),public.log_member_details(new.person_name,new.before_data,new.after_data),'member_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_member_change() from public,anon,authenticated,service_role;
create trigger member_audit_company_log after insert on public.member_audit for each row execute function public.log_member_change();

create function public.log_agent_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),coalesce(new.actor_name,(select name from public.people where id=new.actor_id)),
   'agent',new.agent_id,public.log_agent_action(new.action),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=new.agent_id),'replacement_id',new.details->'replacement_id')),
   'hermes_agent_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_agent_change() from public,anon,authenticated,service_role;
create trigger hermes_agent_audit_company_log after insert on public.hermes_agent_audit for each row execute function public.log_agent_change();

-- Every earlier Card comment, Card activity, Member change and Agent change, with its original author and time.
insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,action,details,source,source_id,created_at)
 select a.company_id,a.actor_id,public.log_actor_kind(a.company_id,a.actor_id),p.name,'card',a.card_id,a.action,a.details,'work_activity',a.id,a.created_at
 from public.work_activity a left join public.people p on p.id=a.actor_id where a.action<>'comment_added' order by a.id
 on conflict (source,source_id) do nothing;
insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,action,body,source,source_id,created_at)
 select c.company_id,c.author_id,public.log_actor_kind(c.company_id,c.author_id),p.name,'card',c.card_id,'note',c.body,'work_comments',c.id,c.created_at
 from public.work_comments c left join public.people p on p.id=c.author_id order by c.id
 on conflict (source,source_id) do nothing;
insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,person_id,action,details,source,source_id,created_at)
 select m.company_id,m.actor_id,public.log_actor_kind(m.company_id,m.actor_id),coalesce(m.actor_name,p.name),'member',m.person_id,public.log_member_action(m.action),
  public.log_member_details(m.person_name,m.before_data,m.after_data),'member_audit',m.id,m.created_at
 from public.member_audit m left join public.people p on p.id=m.actor_id order by m.id
 on conflict (source,source_id) do nothing;
insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
 select h.company_id,h.actor_id,public.log_actor_kind(h.company_id,h.actor_id),coalesce(h.actor_name,p.name),'agent',h.agent_id,public.log_agent_action(h.action),
  jsonb_strip_nulls(jsonb_build_object('agent_name',g.name,'replacement_id',h.details->'replacement_id')),'hermes_agent_audit',h.id,h.created_at
 from public.hermes_agent_audit h left join public.people p on p.id=h.actor_id left join public.hermes_agents g on g.id=h.agent_id order by h.id
 on conflict (source,source_id) do nothing;
