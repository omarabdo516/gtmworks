-- #731: a Conversation's Run that ended because every account it could use ran out (`no_access`, #622) keeps which of
-- its provider's subscription accounts the Engine's credential pool marked exhausted when the Run was closed, so the chat
-- names them by the Owner's name for each (provider_names, #618) beside when the usage resets (#642). Only the Engine's
-- entry id of each account and its place among its provider's accounts are kept (an unnamed second account reads as
-- "ChatGPT 2", as Settings names it); never a label, token or count. One append-only row per account, beside the Run's
-- end, read under the same rule as the end and written only in the same transaction as the end, by the worker's closer.
--
-- Nothing existing is changed: a new table and a new function, which the previous app version never calls.
create table public.conversation_run_ran_out (
 company_id uuid not null,
 conversation_id uuid not null,
 run_id text not null,
 provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
 account text not null check (account ~ '^[A-Za-z0-9_-]{1,64}$'),
 place integer not null check (place between 1 and 64),
 primary key (conversation_id,run_id,provider,account),
 foreign key (conversation_id,run_id) references public.conversation_run_ends(conversation_id,run_id),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id)
);
alter table public.conversation_run_ran_out enable row level security;
create policy conversation_run_ran_out_read on public.conversation_run_ran_out for select to authenticated using (exists(select 1 from public.conversations c
 where c.id=conversation_id and c.company_id=conversation_run_ran_out.company_id and c.person_id=auth.uid() and public.is_member(c.company_id)));
revoke all on public.conversation_run_ran_out from anon,authenticated,service_role;
grant select on public.conversation_run_ran_out to authenticated;
create trigger conversation_run_ran_out_append_only before update or delete on public.conversation_run_ran_out for each row execute function public.refuse_conversation_change();

-- The close of a Run that ran out of usage (close_conversation_run_out_of_usage, unchanged, which keeps when it resets),
-- with the exhausted accounts the closer read from the pool: `ran_out`, a list of {provider, account, place}. Only the
-- accounts of the Run's own provider are kept: the model the Run was started on (conversation_run_notes.model, #158),
-- else its Agent's own model's provider, as the closer read it from the Engine (`own_provider`), and none the Owner
-- switched off (provider_order, #619), which the Run could not have used. Kept only when this call closed the Run and it
-- ended no_access; a row of any other shape is left out, so it never stops the close.
create function public.close_conversation_run_ran_out(conversation uuid, run text, hermes_session text, read_completed boolean,
 usage_resets_at timestamptz, own_provider text, ran_out jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare closed boolean; chosen text;
begin
 closed := public.close_conversation_run_out_of_usage(conversation,run,hermes_session,read_completed,usage_resets_at);
 if not closed or jsonb_typeof(ran_out) is distinct from 'array' or jsonb_array_length(ran_out)>64 then return closed; end if;
 select n.model->>'provider' into chosen from public.conversation_messages m
  join public.conversation_run_notes n on n.conversation_id=m.conversation_id and n.send_key=m.send_key
  where m.conversation_id=conversation and m.run_id=run and m.author='person' and jsonb_typeof(n.model)='object' limit 1;
 insert into public.conversation_run_ran_out(company_id,conversation_id,run_id,provider,account,place)
  select distinct on (a.provider,a.account) e.company_id,e.conversation_id,e.run_id,a.provider,a.account,a.place::integer
  from public.conversation_run_ends e,
   jsonb_to_recordset((select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(ran_out) item where jsonb_typeof(item)='object'))
    as a(provider text,account text,place text)
  where e.conversation_id=conversation and e.run_id=run and e.outcome='no_access'
   and a.provider=coalesce(chosen,own_provider) and a.provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
   and a.account ~ '^[A-Za-z0-9_-]{1,64}$' and a.place ~ '^[1-9][0-9]?$' and a.place::integer<=64
   and not exists(select 1 from public.provider_order o where o.company_id=e.company_id and o.provider=a.provider and o.account=a.account and not o.enabled);
 return closed;
end $$;
revoke all on function public.close_conversation_run_ran_out(uuid,text,text,boolean,timestamptz,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.close_conversation_run_ran_out(uuid,text,text,boolean,timestamptz,text,jsonb) to service_role;
