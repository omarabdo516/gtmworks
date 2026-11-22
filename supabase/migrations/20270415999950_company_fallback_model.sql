-- #622 (spec #611; GLOSSARY: Fallback model): the model a Company's Agents move to once every eligible Provider of the
-- model they chose has run out. The pinned Engine already has the move (v0.23.0 `fallback_providers`, walked only after
-- the credential pool can no longer recover: agent/turn_recovery.py), but keeps it per profile and has no Company level,
-- so the Company's choice is kept here (ADR 0022) and the app and the worker write it to every Agent profile. No row is
-- None, the default: every profile then holds an empty chain and an Agent never moves to another kind of Provider.
-- Nothing here is a secret: a choice is the Engine's provider id and model, as the model pickers take it.
create table public.company_fallback_models (
 company_id uuid primary key references public.companies(id) on delete cascade,
 provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
 model text not null check (model ~ '^[^\s/][^\s]{0,199}$'),
 changed_by uuid references public.people(id) on delete set null,
 changed_at timestamptz not null default now()
);
-- Every Member of the Company reads the choice (a Manager sees it read-only); nobody writes the table directly.
alter table public.company_fallback_models enable row level security;
revoke all on public.company_fallback_models from anon,authenticated,service_role;
grant select on public.company_fallback_models to authenticated;
create policy company_fallback_models_read on public.company_fallback_models for select to authenticated using (public.is_member(company_id));

-- The Owner, and only the Owner, picks the Fallback model or None (both null). Answers the choice as kept, provider/model,
-- or null for None.
create function public.set_company_fallback_model(c uuid, fallback_provider text, fallback_model text) returns text
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'fallbackNotAllowed' using errcode='42501'; end if;
 if fallback_provider is null and fallback_model is null then
  delete from public.company_fallback_models where company_id=c;
  return null;
 end if;
 if coalesce(fallback_provider,'') !~ '^[a-z0-9][a-z0-9._-]{0,63}$' or coalesce(fallback_model,'') !~ '^[^\s/][^\s]{0,199}$' then
  raise exception 'fallbackInvalid' using errcode='22023';
 end if;
 insert into public.company_fallback_models(company_id,provider,model,changed_by) values (c,fallback_provider,fallback_model,auth.uid())
  on conflict (company_id) do update set provider=excluded.provider,model=excluded.model,changed_by=excluded.changed_by,changed_at=now();
 return fallback_provider||'/'||fallback_model;
end $$;
revoke all on function public.set_company_fallback_model(uuid,text,text) from public,anon,service_role;
grant execute on function public.set_company_fallback_model(uuid,text,text) to authenticated;

-- The worker's list: each Company with an Engine, its choice (both null for None) and every profile one of its Agents
-- runs on now, the Company's own included, so an Agent made or moved to its own profile later takes the same choice.
create function public.fallback_model_work() returns table(company_id uuid, provider text, model text, profiles text[])
language sql stable security definer set search_path='' as $$
 select c.id,f.provider,f.model,coalesce((select array_agg(distinct p.profile order by p.profile) from (
   select a.profile from public.hermes_agents a where a.company_id=c.id
   union select k.profile from public.company_profiles k where k.company_id=c.id) p where p.profile is not null),'{}')
 from public.companies c left join public.company_fallback_models f on f.company_id=c.id
 where c.engine_id is not null order by c.id;
$$;
revoke all on function public.fallback_model_work() from public,anon,authenticated,service_role;
grant execute on function public.fallback_model_work() to service_role;

-- A Run whose model call failed because every account it could use ran out, the Fallback model's included when there is
-- one (the pinned Engine's exhausted rate limit, agent/turn_failure_copy.py exhausted_copy), ends as `no_access`: the
-- chat, a channel, a handover and a Card note say so once, and what the Owner can do, instead of offering a send again
-- that cannot work yet. It is a failure like any other everywhere else. The previous app version never sends it.
alter table public.conversation_run_ends drop constraint conversation_run_ends_outcome_check;
alter table public.conversation_run_ends add constraint conversation_run_ends_outcome_check
 check (outcome in ('completed','stopped','lost','failed','no_model','no_credit','key_refused','model_missing','no_access'));
alter table public.channel_runs drop constraint channel_runs_outcome_check;
alter table public.channel_runs add constraint channel_runs_outcome_check
 check (outcome in ('completed','failed','no_model','no_credit','key_refused','model_missing','no_access','stopped','lost'));
alter table public.agent_handovers drop constraint agent_handovers_target_outcome;
alter table public.agent_handovers add constraint agent_handovers_target_outcome
 check (target_outcome in ('completed','failed','no_model','no_credit','key_refused','model_missing','no_access','stopped','lost'));
alter table public.agent_handovers drop constraint agent_handovers_follow_up_outcome;
alter table public.agent_handovers add constraint agent_handovers_follow_up_outcome
 check (follow_up_outcome in ('completed','failed','no_model','no_credit','key_refused','model_missing','no_access','stopped','lost'));
alter table public.note_runs drop constraint note_runs_outcome_check;
alter table public.note_runs add constraint note_runs_outcome_check
 check (outcome in ('completed','failed','no_model','no_credit','key_refused','model_missing','no_access','stopped','lost'));

-- Each closer, and the channel's handovers, from its body as it is now (20270411000000, 20270415997200), unchanged but
-- for taking `no_access` wherever it takes `model_missing`. Replacing a function keeps its arguments, security and grants.
do $$
declare f text; def text;
begin
 foreach f in array array['public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)',
  'public.close_channel_run(bigint,text,text,text,bigint,bigint)','public.close_handover_target(bigint,text,text,text)',
  'public.close_handover_follow_up(bigint,text,text,text)','public.close_handover_answer(bigint,text,text,text)',
  'public.close_note_run(bigint,text,text,text,bigint,bigint)','public.channel_handovers(uuid)'] loop
  def:=pg_get_functiondef(f::regprocedure);
  if position('''model_missing''' in def)=0 or position('''no_access''' in def)>0 then raise exception '% changed: %',f,def; end if;
  execute replace(def,'''model_missing''','''model_missing'',''no_access''');
 end loop;
end $$;
