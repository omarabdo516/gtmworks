-- The tokens each agent run used, as Hermes reported them: one append-only row per run, whether it completed, was
-- stopped or was lost. Null tokens mean Hermes reported nothing usable: usage is unknown, never zero by default.
create table public.conversation_usage (
 company_id uuid not null references public.companies(id),
 conversation_id uuid not null,
 run_id text not null,
 outcome text not null check (outcome in ('completed','stopped','lost','failed')),
 input_tokens bigint check (input_tokens>=0),
 output_tokens bigint check (output_tokens>=0),
 recorded_at timestamptz not null default now(),
 primary key (conversation_id,run_id),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id),
 check ((input_tokens is null)=(output_tokens is null))
);
create index conversation_usage_by_day on public.conversation_usage(company_id,recorded_at);
alter table public.conversation_usage enable row level security;
create policy conversation_usage_read on public.conversation_usage for select to authenticated using (exists(select 1 from public.conversations c where c.id=conversation_id and c.company_id=conversation_usage.company_id and c.person_id=auth.uid() and (public.is_member(c.company_id) or public.agency_access())));
revoke all on public.conversation_usage from anon,authenticated,service_role;
grant select on public.conversation_usage to authenticated;
create trigger conversation_usage_append_only before update or delete on public.conversation_usage for each row execute function public.refuse_conversation_change();

-- A reply stored without its usage (by record_conversation_reply, the previous app version, or before this table
-- existed) still counts: its run is recorded as completed with unknown usage, never left out or counted as zero.
create function public.record_reply_usage() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.conversation_usage(company_id,conversation_id,run_id,outcome,recorded_at) values(new.company_id,new.conversation_id,new.run_id,'completed',new.created_at) on conflict do nothing;
 return null;
end;
$$;
revoke all on function public.record_reply_usage() from public,anon,authenticated,service_role;
create trigger conversation_reply_usage after insert on public.conversation_messages for each row when (new.author='agent') execute function public.record_reply_usage();
insert into public.conversation_usage(company_id,conversation_id,run_id,outcome,recorded_at)
 select company_id,conversation_id,run_id,'completed',created_at from public.conversation_messages where author='agent' on conflict do nothing;

-- How a run ended, read from Hermes by the conversation's own person: a completed run stores its reply, and every
-- ended run stores its usage, once. record_conversation_reply stays for the previous app version.
create function public.record_conversation_run(conversation uuid, run text, run_outcome text, reply text, hermes_session text, used_input bigint, used_output bigint)
returns void language plpgsql security definer set search_path='' as $$
declare existing public.conversations; known boolean := used_input is not null and used_output is not null;
begin
 if auth.uid() is null or not public.agency_access() then raise exception 'conversationAgencyOnly' using errcode='42501'; end if;
 select * into existing from public.conversations where id=conversation and person_id=auth.uid();
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
revoke all on function public.record_conversation_run(uuid,text,text,text,text,bigint,bigint) from public,anon,service_role;
grant execute on function public.record_conversation_run(uuid,text,text,text,text,bigint,bigint) to authenticated;

-- Tokens per company per day (UTC), with the runs whose usage is unknown counted apart. The Agency sees every
-- company; a company Owner sees only the companies they own; everyone else sees nothing.
create function public.usage_by_day() returns table(company_id uuid, company_name text, day date, input_tokens bigint, output_tokens bigint, runs bigint, unknown_runs bigint)
language sql stable security definer set search_path='' as $$
 select u.company_id, co.name, (u.recorded_at at time zone 'UTC')::date, coalesce(sum(u.input_tokens),0)::bigint, coalesce(sum(u.output_tokens),0)::bigint, count(*), count(*) filter (where u.input_tokens is null)
 from public.conversation_usage u join public.companies co on co.id=u.company_id
 where auth.uid() is not null and (public.agency_access() or exists(select 1 from public.members m where m.company_id=u.company_id and m.person_id=auth.uid() and m.removed_at is null and m.role='owner'))
 group by u.company_id, co.name, (u.recorded_at at time zone 'UTC')::date
 order by 3 desc, 2;
$$;
revoke all on function public.usage_by_day() from public,anon,service_role;
grant execute on function public.usage_by_day() to authenticated;
