-- A new Conversation with an Agent other than the main one puts its Card on the board (#144; design-reference: send,
-- dropNewCard). When the Conversation's first Run ends with a reply, one Card appears in the Company's first "In
-- progress" stage, titled from the person's first message, with the Conversation's Agent, tied to the Conversation. A
-- Run that saved a rule, or made or asked for an Agent, is not work for the board; a Conversation with the main Agent
-- gets its Card when Lead hands the work over (#147). The chat stays its person's alone: a Member who sees the Agent sees
-- the Card, and a Member the Agent is hidden from sees neither the Card nor anything written on it.
-- Only adds: every existing Card stays untied, and nothing the previous app version calls changes.

alter table public.work_cards add column conversation_id uuid,
 add constraint work_cards_conversation_fkey foreign key (conversation_id,company_id) references public.conversations(id,company_id) on delete set null (conversation_id);
create unique index work_cards_one_per_conversation on public.work_cards(conversation_id) where conversation_id is not null;

-- The reference's title (send): mentions and a leading command taken out, the first line, at most 44 characters. A
-- message with nothing left is titled by the Agent.
create function public.chat_card_title(message text, agent_name text) returns text language sql immutable set search_path='' as $$
 select coalesce(nullif(btrim(left(btrim(split_part(regexp_replace(regexp_replace(message,'@\w+\s*','','g'),'^/\w+\s*',''),E'\n',1),E' \t\r'),44),E' \t\r'),''),agent_name);
$$;
revoke all on function public.chat_card_title(text,text) from public,anon,authenticated,service_role;

create function public.conversation_reply_card() returns trigger language plpgsql security definer set search_path='' as $$
declare chat public.conversations; agent public.hermes_agents; asked public.conversation_messages; stage bigint;
begin
 select * into chat from public.conversations where id=new.conversation_id;
 select * into agent from public.hermes_agents where id=chat.agent_id and company_id=chat.company_id;
 if not found or agent.is_default then return null; end if;
 select * into asked from public.conversation_messages where conversation_id=chat.id and author='person' order by id limit 1;
 if asked.run_id is distinct from new.run_id
  or exists(select 1 from public.agent_rules where conversation_id=chat.id and run_id=new.run_id)
  or exists(select 1 from public.lead_made_agents where conversation_id=chat.id and run_id=new.run_id)
  or exists(select 1 from public.lead_agent_requests where conversation_id=chat.id and run_id=new.run_id) then return null; end if;
 -- A stage after review takes a Card only through an approval (approval_card_guard), which a new Card has not had.
 select id into stage from public.work_stages where company_id=chat.company_id and board_column='progress' and kind='before_review' order by position,id limit 1;
 if stage is null then return null; end if;
 insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id)
  values(chat.company_id,stage,public.chat_card_title(asked.body,agent.name),agent.id,chat.id)
  on conflict (conversation_id) where conversation_id is not null do nothing;
 return null;
end $$;
revoke all on function public.conversation_reply_card() from public,anon,authenticated,service_role;
-- Judged when the reply's transaction ends: the app writes a Run's rule, made Agent or request before closing the Run,
-- but a writer that keeps both in one transaction may write them after the reply.
create constraint trigger conversation_reply_card after insert on public.conversation_messages deferrable initially deferred
 for each row when (new.author='agent') execute function public.conversation_reply_card();

-- Only the database ties a Card to a Conversation: no Member and no key sets, moves or removes the tie.
create function public.guard_card_conversation() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated','service_role')
  and (tg_op='INSERT' and new.conversation_id is not null or tg_op='UPDATE' and new.conversation_id is distinct from old.conversation_id) then
  raise exception 'cardConversationProtected' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_card_conversation() from public,anon,authenticated,service_role;
create trigger work_card_conversation_guard before insert or update of conversation_id on public.work_cards for each row execute function public.guard_card_conversation();

-- A Card tied to a Conversation follows that Conversation's Agent for the caller (#15), and so does every row written on
-- it; an untied Card reads as before. Restrictive, so each table's own read rule still applies.
create function public.can_see_card(c uuid, card bigint) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_see_conversation_agent(c,(select w.conversation_id from public.work_cards w where w.company_id=c and w.id=card));
$$;
revoke all on function public.can_see_card(uuid,bigint) from public,anon,service_role;
grant execute on function public.can_see_card(uuid,bigint) to authenticated;
create policy card_agent_visible on public.work_cards as restrictive for select to authenticated using (public.can_see_conversation_agent(company_id,conversation_id));
do $$ declare t text; begin
 foreach t in array array['work_checklist','work_card_labels','work_assignees','work_creatives','work_versions','work_comments','work_activity',
  'work_attachments','work_card_visits','note_runs','skill_lessons','waiting_items','company_log'] loop
  execute format('create policy card_agent_visible on public.%I as restrictive for select to authenticated using (public.can_see_card(company_id,card_id))',t);
 end loop;
end $$;
