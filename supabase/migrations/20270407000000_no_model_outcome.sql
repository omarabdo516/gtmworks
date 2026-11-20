-- #422: a Run that failed because its Company's Engine has no model provider at all ends as `no_model`, so the chat
-- tells its person to connect one (an Owner) or to ask the Owner (a Member), instead of offering a retry that cannot
-- succeed. It is a failure like any other everywhere else: only the conversation record reads the difference.
alter table public.conversation_run_ends drop constraint conversation_usage_outcome_check;
alter table public.conversation_run_ends add constraint conversation_run_ends_outcome_check
 check (outcome in ('completed','stopped','lost','failed','no_model'));

-- 20270212000000's, unchanged but for the outcome it takes.
create or replace function public.close_conversation_run(conversation uuid, run text, run_outcome text, reply text, hermes_session text, used_input bigint, used_output bigint, read_completed boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.conversations; closed text; carded boolean := false;
begin
 if run_outcome is null or run_outcome not in ('completed','stopped','lost','failed','no_model') or run_outcome='completed' and coalesce(btrim(reply),'')='' then raise exception 'conversationFailed' using errcode='22023'; end if;
 select * into existing from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages where conversation_id=conversation and author='person' and run_id=run) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if run_outcome='failed' and read_completed then
  carded := exists(select 1 from public.reply_cards where conversation_id=conversation and run_id=run and kind in ('draft','review','hand'))
   or exists(select 1 from public.lead_made_agents where conversation_id=conversation and run_id=run)
   or exists(select 1 from public.lead_agent_requests where conversation_id=conversation and run_id=run)
   or exists(select 1 from public.agent_rules where conversation_id=conversation and run_id=run);
 end if;
 insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
  values(existing.company_id,conversation,run,case when carded then 'completed' else run_outcome end)
  on conflict do nothing returning run_id into closed;
 if closed is null then return false; end if;
 if run_outcome='completed' then
  insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
   values(existing.company_id,conversation,'agent',existing.agent_id,existing.agent_name,left(reply,200000),run) on conflict do nothing;
 end if;
 if run_outcome='completed' or carded then
  update public.conversations set hermes_session_id=hermes_session where id=conversation and hermes_session_id is null and hermes_session is not null;
 end if;
 return true;
end;
$$;
