-- #347 (decision 0042): token use is read from Hermes (the session's totals, the profile's usage analytics), so
-- gtmworks keeps no count. conversation_usage goes with its per-day reader, and channel and note Runs drop their token
-- columns, with no copy of what they held. What the table also held stays, without its tokens: how each Run ended,
-- which the chat record shows ("did not finish") and which closes a Run's open questions and requests. It is renamed
-- conversation_run_ends with its rows, policy and triggers, so its separation is unchanged. The closers keep their
-- arguments for the previous app version and ignore the tokens; its reads of the old table and usage_by_day fail and
-- show no usage until the new version starts.
alter table public.conversation_usage rename to conversation_run_ends;
alter table public.conversation_run_ends drop column input_tokens, drop column output_tokens;
drop index if exists public.conversation_usage_by_day;
alter policy conversation_usage_read on public.conversation_run_ends rename to conversation_run_ends_read;
alter trigger conversation_usage_append_only on public.conversation_run_ends rename to conversation_run_ends_append_only;
alter trigger conversation_usage_closes_questions on public.conversation_run_ends rename to conversation_run_ends_closes_questions;
alter trigger conversation_usage_closes_permissions on public.conversation_run_ends rename to conversation_run_ends_closes_permissions;
alter function public.record_reply_usage() rename to record_reply_end;
alter trigger conversation_reply_usage on public.conversation_messages rename to conversation_reply_end;
drop function if exists public.usage_by_day();
alter table public.channel_runs drop column if exists input_tokens, drop column if exists output_tokens;
alter table public.note_runs drop column if exists input_tokens, drop column if exists output_tokens;

-- The four closers that wrote tokens, as they are now without them (20270119000000, 20261204000000, 20261219000000,
-- 20261224000000).
create or replace function public.close_conversation_run(conversation uuid, run text, run_outcome text, reply text, hermes_session text, used_input bigint, used_output bigint, read_completed boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.conversations; closed text; carded boolean := false;
begin
 if run_outcome is null or run_outcome not in ('completed','stopped','lost','failed') or run_outcome='completed' and coalesce(btrim(reply),'')='' then raise exception 'conversationFailed' using errcode='22023'; end if;
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

create or replace function public.record_conversation_run(conversation uuid, run text, run_outcome text, reply text, hermes_session text, used_input bigint, used_output bigint)
returns void language plpgsql security definer set search_path='' as $$
declare existing public.conversations;
begin
 if auth.uid() is null then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into existing from public.conversations where id=conversation and person_id=auth.uid();
 if found and not public.is_company_owner(existing.company_id) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if not found or not exists(select 1 from public.conversation_messages where conversation_id=conversation and author='person' and run_id=run) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if run_outcome not in ('completed','stopped','lost','failed') or run_outcome='completed' and coalesce(trim(reply),'')='' then raise exception 'conversationFailed' using errcode='22023'; end if;
 -- The end first: the reply's own trigger then finds the run already recorded with its outcome.
 insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome)
  values(existing.company_id,conversation,run,run_outcome) on conflict do nothing;
 if run_outcome='completed' then
  insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
   values(existing.company_id,conversation,'agent',existing.agent_id,existing.agent_name,left(reply,200000),run) on conflict do nothing;
  update public.conversations set hermes_session_id=hermes_session where id=conversation and hermes_session_id is null and hermes_session is not null;
 end if;
end;
$$;

create or replace function public.close_channel_run(message bigint, run text, run_outcome text, reply text, used_input bigint, used_output bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.channel_runs;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(reply),'') <> '') then
  raise exception 'channelFailed' using errcode='22023'; end if;
 update public.channel_runs set outcome=run_outcome, closed_at=now()
  where message_id=message and outcome is null and run_id is not distinct from run returning * into r;
 if r.message_id is null then return false; end if;
 if run_outcome='completed' then
  insert into public.channel_messages(company_id, channel_id, author, agent_id, author_name, body, reply_to)
   values (r.company_id, r.channel_id, 'agent', r.agent_id, r.agent_name, left(reply, 200000), message) on conflict (reply_to) do nothing;
 end if;
 return true;
end $$;

create or replace function public.close_note_run(message bigint, run text, run_outcome text, reply text, used_input bigint, used_output bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.note_runs;
begin
 if run_outcome is null or run_outcome not in ('completed','failed','stopped','lost') or (run_outcome='completed') <> (coalesce(btrim(reply),'') <> '') then
  raise exception 'noteFailed' using errcode='22023'; end if;
 update public.note_runs set outcome=run_outcome, closed_at=now(),
  reply=case when run_outcome='completed' then left(close_note_run.reply, 200000) end
  where note_id=message and outcome is null and run_id is not distinct from run returning * into r;
 if r.note_id is null then return false; end if;
 if run_outcome='completed' then
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,body,source,source_id,created_at)
   values (r.company_id, r.agent_id, 'agent', r.agent_name, 'card', r.card_id, r.agent_id, 'note_reply',
           jsonb_build_object('reply_to', r.note_id), r.reply, 'note_runs', r.note_id, r.closed_at)
   on conflict (source,source_id) do nothing;
 end if;
 return true;
end $$;

-- Every other function that asks whether a Run ended reads the renamed table, each from its body as it is now, so no
-- earlier body comes back: the reply trigger, the open-run and wait checks, the question and permission guards and the
-- profile moves. Replacing a function keeps its arguments, security and grants.
do $$
declare f oid;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc like '%conversation_usage%' loop
  execute replace(pg_get_functiondef(f),'conversation_usage','conversation_run_ends');
 end loop;
end $$;
