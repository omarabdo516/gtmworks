-- #30: the Owner connects and disconnects the apps the Company's Agents use. An app is a server of the bundled Engine's
-- own catalogue in the Company's profile, on for every Agent of the Company or off (lib/app-catalogue.mjs); the Engine
-- holds its sign-in. gtmworks keeps two things here: the sign-ins an Owner started, so the vendor's redirect back to
-- gtmworks (/api/apps/callback/<app>) is handed on only for a sign-in that person started and only while they are still
-- that Company's Owner, and the Company's log of each connect and disconnect, with who did it.
--
-- Nothing existing is rewritten: the new table starts empty and the new audit column is null on every old row. The
-- previous app version never connects an app, and runs against this database unchanged.

create table public.company_app_sign_ins (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 app text not null check (app ~ '^[a-z][a-z0-9-]{0,63}$'),
 flow_id text not null unique check (flow_id ~ '^[A-Za-z0-9_-]{8,128}$'),
 started_by uuid not null references public.people(id),
 started_at timestamptz not null default now(),
 finished_at timestamptz
);
create index company_app_sign_ins_open on public.company_app_sign_ins(started_by,app,started_at) where finished_at is null;
alter table public.company_app_sign_ins enable row level security;
-- The Company's Owners read its sign-ins; only the functions below write them.
create policy company_app_sign_ins_read on public.company_app_sign_ins for select to authenticated using (public.is_company_owner(company_id));
revoke all on public.company_app_sign_ins from anon,authenticated,service_role;
grant select on public.company_app_sign_ins to authenticated;

-- Connecting and disconnecting are kept in company_audit beside renames and level changes, and copied into the log.
alter table public.company_audit add column app text;
alter table public.company_audit drop constraint company_audit_action_check;
alter table public.company_audit add constraint company_audit_action_check check (action in ('company_renamed','agent_level_changed','app_connected','app_disconnected'));
alter table public.company_audit drop constraint company_audit_values;
alter table public.company_audit add constraint company_audit_values check (
 (action='company_renamed' and old_name is not null and new_name is not null)
 or (action='agent_level_changed' and old_level between 1 and 3 and new_level between 1 and 3)
 or (action in ('app_connected','app_disconnected') and app is not null));

create or replace function public.log_company_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),(select name from public.people where id=new.actor_id),
   'company',new.action,case when new.action='agent_level_changed' then jsonb_build_object('old_level',new.old_level,'new_level',new.new_level)
    when new.action in ('app_connected','app_disconnected') then jsonb_build_object('app',new.app)
    else jsonb_build_object('old_name',new.old_name,'new_name',new.new_name) end,'company_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_company_change() from public,anon,authenticated,service_role;

-- The Owner started a sign-in in the Engine: its flow is kept as theirs.
create function public.start_app_sign_in(c uuid, app_key text, flow text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'appsNotAllowed' using errcode='42501'; end if;
 if coalesce(app_key,'') !~ '^[a-z][a-z0-9-]{0,63}$' or coalesce(flow,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'appsInvalid' using errcode='22023'; end if;
 insert into public.company_app_sign_ins(company_id,app,flow_id,started_by) values (c,app_key,flow,auth.uid());
end $$;
revoke all on function public.start_app_sign_in(uuid,text,text) from public,anon,service_role;
grant execute on function public.start_app_sign_in(uuid,text,text) to authenticated;

-- The Engine says the caller's own sign-in finished: it is closed and the connect is logged, once. Another person's
-- sign-in, a closed one, or one whose starter is no longer the Company's Owner finishes nothing.
create function public.finish_app_sign_in(app_key text, flow text) returns table(company_id uuid, slug text)
language plpgsql security definer set search_path='' as $$
declare pending public.company_app_sign_ins;
begin
 select * into pending from public.company_app_sign_ins s where s.app=app_key and s.flow_id=flow and s.started_by=auth.uid() and s.finished_at is null for update;
 if pending.id is null then return; end if;
 if not public.is_company_owner(pending.company_id) then raise exception 'appsNotAllowed' using errcode='42501'; end if;
 update public.company_app_sign_ins s set finished_at=now() where s.id=pending.id;
 insert into public.company_audit(company_id,actor_id,action,app) values (pending.company_id,auth.uid(),'app_connected',pending.app);
 return query select pending.company_id,(select c.slug from public.companies c where c.id=pending.company_id);
end $$;
revoke all on function public.finish_app_sign_in(text,text) from public,anon,service_role;
grant execute on function public.finish_app_sign_in(text,text) to authenticated;

-- The Engine removed the app from the Company's profile.
create function public.record_app_disconnected(c uuid, app_key text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'appsNotAllowed' using errcode='42501'; end if;
 if coalesce(app_key,'') !~ '^[a-z][a-z0-9-]{0,63}$' then raise exception 'appsInvalid' using errcode='22023'; end if;
 insert into public.company_audit(company_id,actor_id,action,app) values (c,auth.uid(),'app_disconnected',app_key);
end $$;
revoke all on function public.record_app_disconnected(uuid,text) from public,anon,service_role;
grant execute on function public.record_app_disconnected(uuid,text) to authenticated;
