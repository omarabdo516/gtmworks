-- #621 (spec #611; GLOSSARY: Provider): when a request runs out of one subscription account's quota, the Company's Engine
-- goes on with it on the next account of the same kind in the Owner's order (scripts/engine-pool-order.sh), and records
-- each move it made. The worker copies each move into the Company's log once, as gtmworks's own entry: the provider, the
-- two accounts by the Engine's id for each, and the names they read under then (the Owner's, or their kind's with their
-- place, "ChatGPT 2"). Nothing here is a credential, a label the Engine took from a token, or an error text.
--
-- Nothing existing is rewritten: company_audit gains five nullable columns and a branch in each of its checks, which no
-- old row holds, and log_company_change copies the new action as it copies the others. The previous app version never
-- calls the new function and runs against this database unchanged.

alter table public.company_audit add column switch_id text, add column from_account text, add column to_account text,
 add column from_name text, add column to_name text;
-- A move the Engine recorded is copied once, however often the worker reads the record.
create unique index company_audit_switch on public.company_audit(company_id,switch_id) where switch_id is not null;

alter table public.company_audit drop constraint company_audit_action_check;
alter table public.company_audit add constraint company_audit_action_check check (action in ('company_renamed','agent_level_changed','company_knowledge_changed','app_connected','app_disconnected','subscription_connected','subscription_disconnected','provider_key_set','provider_key_removed','provider_switched'));
alter table public.company_audit drop constraint company_audit_values;
alter table public.company_audit add constraint company_audit_values check (
 (action='company_renamed' and old_name is not null and new_name is not null)
 or (action='agent_level_changed' and old_level between 1 and 3 and new_level between 1 and 3)
 or (action='company_knowledge_changed' and knowledge_part is not null and knowledge_cleared is not null)
 or (action in ('app_connected','app_disconnected') and app is not null)
 or (action in ('subscription_connected','subscription_disconnected') and provider in ('openai-codex','anthropic'))
 or (action in ('provider_key_set','provider_key_removed') and provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$')
 or (action='provider_switched' and actor_id is null and switch_id is not null and from_account is not null and to_account is not null
  and from_name is not null and to_name is not null and provider in ('openai-codex','anthropic') and switch_id ~ '^[0-9a-f]{32}$'
  and from_account ~ '^[A-Za-z0-9_-]{1,64}$' and to_account ~ '^[A-Za-z0-9_-]{1,64}$' and from_account<>to_account
  and from_name=btrim(from_name) and char_length(from_name) between 1 and 80 and from_name !~ '[[:cntrl:]]'
  and to_name=btrim(to_name) and char_length(to_name) between 1 and 80 and to_name !~ '[[:cntrl:]]'));

-- 20270127000000's, with the Engine's move to another account beside the subscription's own rows.
create or replace function public.log_company_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),(select name from public.people where id=new.actor_id),
   'company',new.action,case when new.action='agent_level_changed' then jsonb_build_object('old_level',new.old_level,'new_level',new.new_level)
    when new.action='company_knowledge_changed' then jsonb_build_object('part',new.knowledge_part,'cleared',new.knowledge_cleared)
    when new.action in ('app_connected','app_disconnected') then jsonb_build_object('app',new.app)
     ||case when new.agent_id is null then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object('agent_name',(select a.name from public.hermes_agents a where a.id=new.agent_id))) end
    when new.action in ('subscription_connected','subscription_disconnected','provider_key_set','provider_key_removed') then jsonb_build_object('provider',new.provider)
    when new.action='provider_switched' then jsonb_build_object('provider',new.provider,'from_name',new.from_name,'to_name',new.to_name)
    else jsonb_build_object('old_name',new.old_name,'new_name',new.new_name) end,'company_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_company_change() from public,anon,authenticated,service_role;

-- The worker copies the moves the Company's own Engine recorded: `switches` is
-- [{"id":…,"provider":…,"from":…,"to":…,"from_name":…,"to_name":…,"at":<seconds since 1970>},…]. A move already copied
-- is left as it is; one that names no move of a subscription is refused whole, so nothing is half copied. The time is
-- the Engine's, unless it is later than now. Answers how many moves were new.
create function public.record_provider_switches(c uuid, switches jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 if c is null or not exists(select 1 from public.companies where id=c) then raise exception 'providerSwitchInvalid' using errcode='22023'; end if;
 if jsonb_typeof(switches) is distinct from 'array' or jsonb_array_length(switches)>100
  or exists(select 1 from jsonb_array_elements(switches) s where jsonb_typeof(s) is distinct from 'object'
   or jsonb_typeof(s->'at') is distinct from 'number' or coalesce(s->>'id','') !~ '^[0-9a-f]{32}$') then
  raise exception 'providerSwitchInvalid' using errcode='22023';
 end if;
 insert into public.company_audit(company_id,actor_id,action,provider,switch_id,from_account,to_account,from_name,to_name,created_at)
  select c,null,'provider_switched',s->>'provider',s->>'id',s->>'from',s->>'to',s->>'from_name',s->>'to_name',
   least(now(),to_timestamp((s->>'at')::double precision))
  from jsonb_array_elements(switches) s
  on conflict (company_id,switch_id) where switch_id is not null do nothing;
 get diagnostics added=row_count;
 return added;
exception when check_violation or not_null_violation or numeric_value_out_of_range or invalid_parameter_value then
 raise exception 'providerSwitchInvalid' using errcode='22023';
end $$;
revoke all on function public.record_provider_switches(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_provider_switches(uuid,jsonb) to service_role;

-- What the worker gives each Company's Engine and reads back from it: every Company that has an Engine, with its
-- Providers' places, switches and names (provider_order, provider_names), so the Engine takes its accounts in the
-- Owner's order and skips one switched off, and a move reads under the names the Owner gave. `ordered` says the Owner
-- placed or switched the Provider at some time, so a switch turned on again is still given to the Engine; a Provider only
-- named was never ordered. No credential is here.
create function public.provider_accounts_work() returns table(company_id uuid, accounts jsonb)
language sql stable security definer set search_path='' as $$
 select c.id,coalesce((select jsonb_agg(jsonb_build_object('provider',k.provider,'account',k.account,'ordered',o.company_id is not null,'place',o.place,'enabled',coalesce(o.enabled,true),'name',n.name)
   order by k.provider,k.account)
  from (select p.provider,p.account from public.provider_order p where p.company_id=c.id
   union select n.provider,n.account from public.provider_names n where n.company_id=c.id) k
  left join public.provider_order o on o.company_id=c.id and o.provider=k.provider and o.account=k.account
  left join public.provider_names n on n.company_id=c.id and n.provider=k.provider and n.account=k.account),'[]'::jsonb)
 from public.companies c where c.engine_id is not null order by c.id;
$$;
revoke all on function public.provider_accounts_work() from public,anon,authenticated,service_role;
grant execute on function public.provider_accounts_work() to service_role;
