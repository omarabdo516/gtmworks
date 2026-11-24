-- #644 (spec #611; GLOSSARY: Fallback model): a request the Company's Engine moved to the Company's Fallback model, once
-- every eligible account of the model it was to run on ran out (#622), is logged in the Company's Activity. The worker
-- reads the model that answered a completed Run from the Engine's record of it, and copies one entry per Run, as
-- gtmworks's own, naming the model the Run was to run on and the one that answered. Nothing here is a secret: each model
-- is the Engine's provider id and model, as the model pickers name them.
--
-- Nothing existing is rewritten: company_audit gains five nullable columns and a branch in each of its checks, which no
-- old row holds, and log_company_change copies the new action as it copies the others. The previous app version never
-- calls the new function and runs against this database unchanged.

alter table public.company_audit add column run_id text, add column from_provider text, add column from_model text,
 add column to_provider text, add column to_model text;
-- One entry per Run, however often a closer reads it.
create unique index company_audit_fallback_run on public.company_audit(company_id,run_id) where run_id is not null;

alter table public.company_audit drop constraint company_audit_action_check;
alter table public.company_audit add constraint company_audit_action_check check (action in ('company_renamed','agent_level_changed','company_knowledge_changed','app_connected','app_disconnected','subscription_connected','subscription_disconnected','provider_key_set','provider_key_removed','provider_switched','fallback_model_used'));
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
  and to_name=btrim(to_name) and char_length(to_name) between 1 and 80 and to_name !~ '[[:cntrl:]]')
 or (action='fallback_model_used' and actor_id is null and run_id is not null and from_provider is not null and from_model is not null
  and to_provider is not null and to_model is not null and run_id ~ '^[\w.:-]{1,200}$'
  and from_provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$' and to_provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  and from_model ~ '^[^\s[:cntrl:]]{1,200}$' and to_model ~ '^[^\s[:cntrl:]]{1,200}$'
  and (from_provider,from_model) is distinct from (to_provider,to_model)));

-- 20270415999900's, with the move to the Fallback model beside the move to another account.
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
    when new.action='fallback_model_used' then jsonb_build_object('from_provider',new.from_provider,'from_model',new.from_model,'to_provider',new.to_provider,'to_model',new.to_model)
    else jsonb_build_object('old_name',new.old_name,'new_name',new.new_name) end,'company_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_company_change() from public,anon,authenticated,service_role;

-- The worker reads the Company's choice to tell a move to it from a Run that never moved (lib/fallback-model.mjs
-- logFallbackMove); it writes the table only through set_company_fallback_model's Owner.
grant select on public.company_fallback_models to service_role;

-- The worker copies one move: Run `run` of Company `c` was to run on from_provider/from_model, and the Company's Fallback
-- model's provider answered it with to_provider/to_model. A Company with None, or an answer from any other provider, is
-- no move to its Fallback model and is refused. A Run already logged is left as it is. Answers whether the entry is new.
create function public.record_fallback_move(c uuid, run text, from_provider text, from_model text, to_provider text, to_model text) returns boolean
language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 if c is null or not exists(select 1 from public.company_fallback_models f where f.company_id=c and f.provider=to_provider) then
  raise exception 'fallbackMoveInvalid' using errcode='22023';
 end if;
 insert into public.company_audit(company_id,actor_id,action,run_id,from_provider,from_model,to_provider,to_model)
  values (c,null,'fallback_model_used',run,from_provider,from_model,to_provider,to_model)
  on conflict (company_id,run_id) where run_id is not null do nothing;
 get diagnostics added=row_count;
 return added>0;
exception when check_violation or not_null_violation then
 raise exception 'fallbackMoveInvalid' using errcode='22023';
end $$;
revoke all on function public.record_fallback_move(uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_fallback_move(uuid,text,text,text,text,text) to service_role;
