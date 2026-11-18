-- #147: a Card follows a handover. A chat with Lead puts no Card on the board by itself (#144): the Agent Lead hands the
-- work to owns it (design-reference: send, dropNewCard, mainTurn). When #317's handover is kept, its Card follows: a
-- Conversation with no Card gets one under "In progress" for the Agent handed the work, titled and tied as #144's Card
-- is; a Conversation that already has one gives it that Agent, so its foot shows that Agent's job. The handover's log row
-- (design-reference: runSteps's handoff row) is written on the Card, so the Card's Log tab reads "handed to <Agent>".
--
-- Only adds: the Card is made once (the one Card a Conversation may have, work_cards_one_per_conversation), and the log
-- row once (one per handover). Nothing existing is rewritten but lead_hand_to_agent, whose checks and answer stay as they
-- are: the previous app version runs against this, and its own handovers put their Card here too.

alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit','note_runs','reply_cards','member_invitations','reply_card_answers','channel_permissions','agent_handovers'));

-- 20270320000000's lead_hand_to_agent, with the Card that follows the handover it keeps.
create or replace function public.lead_hand_to_agent(conversation uuid, run text, call text, agent_name text, goal text, context text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare talk public.conversations; target public.hermes_agents; handed public.agent_handovers; asker text;
 card bigint; card_agent uuid; stage bigint; first_words text;
begin
 select * into talk from public.conversations where id=conversation;
 -- A call that cannot be carried out answers as a value, never an error: the run that made it still closes.
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  then return jsonb_build_object('state','refused'); end if;
 if talk.agent_id is null or not public.may_hand_to_agent(talk.company_id,talk.agent_id,talk.person_id)
  then return jsonb_build_object('state','refused'); end if;
 if coalesce(agent_name,'') = '' or coalesce(goal,'') = '' then return jsonb_build_object('state','ignored'); end if;
 select * into target from public.hermes_agents a
  where a.company_id=talk.company_id and a.id<>talk.agent_id and a.profile is not null
   and lower(btrim(a.name))=lower(btrim(agent_name)) and public.agent_visible_to(talk.company_id,talk.person_id,a.id)
  order by a.id limit 1;
 if not found then return jsonb_build_object('state','ignored'); end if;
 insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,context)
  values(talk.company_id,conversation,run,call,talk.agent_id,target.id,btrim(goal),nullif(btrim(coalesce(context,'')),''))
  on conflict (conversation_id,run_id,call_id) do nothing returning * into handed;
 -- The same call again keeps nothing twice: one handover, and so one Card and one log row.
 if handed.id is not null then
  select w.id,w.agent_id into card,card_agent from public.work_cards w where w.company_id=talk.company_id and w.conversation_id=conversation;
  if card is null then
   -- As #144's Card: the Company's first stage In progress, titled from the person's first message in this chat.
   select s.id into stage from public.work_stages s where s.company_id=talk.company_id and s.board_column='progress' and s.kind='before_review' order by s.position,s.id limit 1;
   if stage is not null then
    select m.body into first_words from public.conversation_messages m where m.conversation_id=conversation and m.author='person' order by m.id limit 1;
    insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id)
     values(talk.company_id,stage,public.chat_card_title(first_words,target.name),target.id,conversation)
     on conflict (conversation_id) where conversation_id is not null do nothing returning id into card;
    if card is null then select w.id into card from public.work_cards w where w.company_id=talk.company_id and w.conversation_id=conversation; end if;
   end if;
  elsif card_agent is distinct from target.id then
   update public.work_cards set agent_id=target.id where company_id=talk.company_id and id=card;
  end if;
  if card is not null then
   select a.name into asker from public.hermes_agents a where a.company_id=talk.company_id and a.id=talk.agent_id;
   -- The one who handed the work is the row's actor and the Agent it went to is the Agent the row is about, so a Member
   -- who does not see either one reads no row (company_log_read) and no name in the Card's crew (crew).
   insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
    values(talk.company_id,talk.agent_id,'agent',asker,'card',card,target.id,'agent_handed_to',
     jsonb_build_object('agent_name',asker,'to_name',target.name,'goal',handed.goal),'agent_handovers',handed.id,handed.created_at)
    on conflict (source,source_id) do nothing;
  end if;
 end if;
 return jsonb_build_object('state','created','agent',target.name);
end $$;
revoke all on function public.lead_hand_to_agent(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.lead_hand_to_agent(uuid,text,text,text,text,text) to service_role;
