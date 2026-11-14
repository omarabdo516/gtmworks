-- The Owner renames the Company (#26), and the rename is in the Company's log (#11) with who did it and the old and
-- new name. Companies have no update policy, so a signed-in person changes a name only through rename_company,
-- which checks that the caller is an active Owner of that Company. The name is trimmed and must be 1 to 80
-- characters; the slug (the Company's address) never changes.
-- Each rename is written to company_audit (as Member changes are to member_audit), in the same transaction as the
-- new name, and a trigger copies it into company_log as a row about the Company itself. A refused rename writes
-- nothing. Nothing existing is rewritten, and the previous app version, which never renames a Company, runs against
-- this database unchanged.

create table public.company_audit (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 actor_id uuid references public.people(id),
 action text not null check (action in ('company_renamed')),
 old_name text not null,
 new_name text not null,
 created_at timestamptz not null default now()
);
alter table public.company_audit enable row level security;
-- Read through the Company's log only; no Role writes, changes or deletes a row here.
revoke all on public.company_audit from anon,authenticated,service_role;

-- The log takes rows about the Company itself, copied from company_audit.
alter table public.company_log drop constraint company_log_subject_check;
alter table public.company_log add constraint company_log_subject_check check (subject in ('card','member','agent','company'));
alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit'));

create function public.log_company_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),(select name from public.people where id=new.actor_id),
   'company',new.action,jsonb_build_object('old_name',new.old_name,'new_name',new.new_name),'company_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_company_change() from public,anon,authenticated,service_role;
create trigger company_audit_company_log after insert on public.company_audit for each row execute function public.log_company_change();

create function public.rename_company(c uuid, company_name text) returns text
language plpgsql security definer set search_path='' as $$
declare cleaned text:=btrim(coalesce(company_name,'')); previous text;
begin
 if not public.is_company_owner(c) then raise exception 'companyRenameNotAllowed' using errcode='42501'; end if;
 if cleaned='' or char_length(cleaned)>80 then raise exception 'companyNameInvalid' using errcode='22023'; end if;
 select name into previous from public.companies where id=c for update;
 if previous is distinct from cleaned then
  update public.companies set name=cleaned where id=c;
  insert into public.company_audit(company_id,actor_id,action,old_name,new_name) values (c,auth.uid(),'company_renamed',previous,cleaned);
 end if;
 return cleaned;
end $$;
revoke all on function public.rename_company(uuid,text) from public,anon,service_role;
grant execute on function public.rename_company(uuid,text) to authenticated;
