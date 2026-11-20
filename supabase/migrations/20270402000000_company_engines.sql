-- #380, ADR 0018: gtmworks keeps one record per Company's Engine: which Company, where it is reached, and its key,
-- encrypted with the install's WEBHOOK_ENCRYPTION_KEY as ADR 0008 kept a pasted Hermes's key. Only server code reads it:
-- no Member, the Owner included, and a Member of one Company cannot tell that another Company's record exists because
-- `authenticated` and `anon` hold no privilege on the table at all. A Company is made only when an Engine record is
-- waiting for it: the installer registers the install's Engine, first-run attaches the first Company, and `company add`
-- (#382) makes the Engine first. The trigger claims the oldest waiting record; with none, the insert fails.
create table public.company_engines (
 id uuid primary key default gen_random_uuid(),
 company_id uuid unique references public.companies(id) on delete cascade,
 address text not null check (length(address) between 1 and 2048),
 key_encrypted text not null check (length(key_encrypted) > 0),
 created_at timestamptz not null default now()
);
alter table public.company_engines enable row level security;
-- No policy and no grant to anon or authenticated: a Member's query reads no row and cannot even tell the table has one.
revoke all on public.company_engines from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.company_engines to service_role;

-- A Company with no Engine record to attach to is never made. The row is claimed after the Company is written, so the
-- foreign key sees it; a failure rolls the whole insert back. The record is locked while it is claimed, so two Companies
-- made at once never take the same one.
create function public.attach_company_engine() returns trigger language plpgsql security definer set search_path='' as $function$
declare waiting uuid;
begin
 select e.id into waiting from public.company_engines e where e.company_id is null order by e.created_at,e.id limit 1 for update;
 if waiting is null then raise exception 'companyEngineMissing' using errcode='55000'; end if;
 update public.company_engines set company_id=new.id where id=waiting;
 return new;
end $function$;
revoke all on function public.attach_company_engine() from public,anon,authenticated,service_role;
create trigger attach_company_engine after insert on public.companies for each row execute function public.attach_company_engine();

-- The worker's keepers of Agent profiles, profile health and team rules now name the Company each row belongs to, so each
-- row asks for its own Engine (lib/company-profiles.mjs, lib/agent-rules.mjs). Their grants are kept.
drop function public.agent_profile_work();
create function public.agent_profile_work() returns table(agent_id uuid, company_id uuid, profile text, agent_level smallint, tools_level smallint, tools_policy integer, tools_pending boolean, instructions text, subagents boolean)
language sql stable security definer set search_path='' as $$
 select p.agent_id,p.company_id,p.profile,co.agent_level,p.tools_level,p.tools_policy,p.tools_pending,a.instructions,p.subagents
 from public.agent_profiles p join public.hermes_agents a on a.id=p.agent_id and a.company_id=p.company_id
  join public.companies co on co.id=p.company_id
 where p.tools_level is null or p.tools_level<>co.agent_level or p.tools_policy is distinct from public.engine_tool_policy() or p.tools_pending
 order by p.tools_level is not null,md5(p.agent_id::text||date_trunc('minute',now())::text)
 limit 100;
$$;
revoke all on function public.agent_profile_work() from public,anon,authenticated;
grant execute on function public.agent_profile_work() to service_role;

drop function public.engine_tools_due();
create function public.engine_tools_due() returns table(company_id uuid, profile text) language sql stable security definer set search_path='' as $function$
 select distinct a.company_id,a.profile from public.hermes_agents a where a.profile ~ '^(co|ag)-[0-9a-f]{32}$' order by 2 limit 500;
$function$;
revoke all on function public.engine_tools_due() from public,anon,authenticated;
grant execute on function public.engine_tools_due() to service_role;

drop function public.agent_soul_rules_work();
create function public.agent_soul_rules_work() returns table(company_id uuid, profile text, rules jsonb)
language sql stable security definer set search_path='' as $$
 select x.company_id,x.profile,coalesce((select jsonb_agg(r.body order by r.said_at,r.id) from public.agent_rules r
   where r.agent_id=x.id and r.removed_at is null and (r.suggestion is null or r.suggestion='approved')),'[]')
 from (select a.id,a.company_id,coalesce((select p.profile from public.agent_profiles p where p.agent_id=a.id and p.tools_level is not null),
   case when a.is_default then (select c.profile from public.company_profiles c where c.company_id=a.company_id) end) as profile
  from public.hermes_agents a) x
 where x.profile is not null
 order by md5(x.id::text||date_trunc('minute',now())::text)
 limit 100;
$$;
revoke all on function public.agent_soul_rules_work() from public,anon,authenticated;
grant execute on function public.agent_soul_rules_work() to service_role;
