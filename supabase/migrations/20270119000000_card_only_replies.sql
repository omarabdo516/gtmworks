-- #227: a Run whose whole reply is a card closes as done. The engine reports a completed Run with no words as failed, so
-- the closer also says whether it read the Run completed and carried out every one of its calls (read_completed). Only
-- then is a failed close with no words recorded as completed, when the Run left something the chat draws as its turn: a
-- draft, review or hand card, an Agent Lead made, a request Lead filed, or a rule it saved or suggested. A kind not
-- listed here (a question, stored while the Run still works) never counts, so each new kind is chosen here on purpose.
-- No agent message is stored for it. The outcome is chosen before the insert because conversation_usage is append-only.
-- The seven-argument close stays for the previous app version and closes as before (read_completed false).
create function public.close_conversation_run(conversation uuid, run text, run_outcome text, reply text, hermes_session text, used_input bigint, used_output bigint, read_completed boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.conversations; known boolean := used_input is not null and used_output is not null; closed text; carded boolean := false;
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
 insert into public.conversation_usage(company_id,conversation_id,run_id,outcome,input_tokens,output_tokens)
  values(existing.company_id,conversation,run,case when carded then 'completed' else run_outcome end,case when known then used_input end,case when known then used_output end)
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
revoke all on function public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean) from public,anon,authenticated;
grant execute on function public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean) to service_role;

create or replace function public.close_conversation_run(conversation uuid, run text, run_outcome text, reply text, hermes_session text, used_input bigint, used_output bigint)
returns boolean language sql security definer set search_path='' as $$
 select public.close_conversation_run(conversation,run,run_outcome,reply,hermes_session,used_input,used_output,false);
$$;
revoke all on function public.close_conversation_run(uuid,text,text,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.close_conversation_run(uuid,text,text,text,text,bigint,bigint) to service_role;
