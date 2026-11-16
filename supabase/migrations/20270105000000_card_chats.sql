-- A chat starts from a Card (#145; design-reference: send, the sheet branch). A Card with an Agent and no Conversation
-- takes one when a Member who may write, and who sees that Agent, sends it a first message from the Card's sheet: the
-- Conversation is theirs, tied to the Card, and a Card under Ideas or Planned moves to the Company's first "In progress"
-- stage, logged as a board move by that Member. The Card stays the only one: #144's reply Card finds the tie taken.
-- The chat stays its person's alone (#25): every other Member who sees the Card learns only its person's first name.
-- Only adds: nothing the previous app version calls changes.

-- Refusals: 42501 conversationNotAllowed (a Viewer, or not a Member), P0002 conversationNotFound (no such Card, a Card
-- or an Agent hidden from the caller, a Card with no Agent, or an id that already names a Conversation), 42501
-- cardChatTaken (another Member's Conversation is on the Card). The Card's own Conversation of the caller is returned
-- as it is, so a retry or a second tab changes nothing.
create function public.start_card_conversation(c uuid, card bigint, conversation uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare w public.work_cards; chosen public.hermes_agents; progress bigint;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 -- Locked first, so two Members starting at once are served one after the other and the second finds the tie.
 select * into w from public.work_cards where company_id=c and id=card for update;
 if not found or not public.can_see_card(c,card) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if w.conversation_id is not null then
  if exists(select 1 from public.conversations v where v.id=w.conversation_id and v.company_id=c and v.person_id=auth.uid()) then return w.conversation_id; end if;
  raise exception 'cardChatTaken' using errcode='42501';
 end if;
 select * into chosen from public.hermes_agents where id=w.agent_id and company_id=c;
 if not found or not public.can_see_agent(c,chosen.id) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if conversation is null or exists(select 1 from public.conversations where id=conversation) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),chosen.id,chosen.name);
 -- The column a board move to "In progress" lands in; a stage after review takes a Card only through an approval.
 select id into progress from public.work_stages where company_id=c and board_column='progress' and kind='before_review' order by position,id limit 1;
 perform set_config('work.evidence','',true);
 update public.work_cards set conversation_id=conversation,
  stage_id=case when progress is not null and exists(select 1 from public.work_stages s where s.company_id=c and s.id=w.stage_id and s.board_column in ('ideas','planned')) then progress else stage_id end
  where company_id=c and id=card;
 return conversation;
end $$;
revoke all on function public.start_card_conversation(uuid,bigint,uuid) from public,anon,service_role;
grant execute on function public.start_card_conversation(uuid,bigint,uuid) to authenticated;

-- Whose chat is on a Card, for the sheet's lock: the first name of its person, to a Member who sees the Card; nothing
-- else about the Conversation.
create function public.card_chat_person(c uuid, card bigint) returns text language sql stable security definer set search_path='' as $$
 select split_part(btrim(p.name),' ',1) from public.work_cards w
  join public.conversations v on v.id=w.conversation_id and v.company_id=w.company_id
  join public.people p on p.id=v.person_id
 where w.company_id=c and w.id=card and public.is_member(c) and public.can_see_card(c,card);
$$;
revoke all on function public.card_chat_person(uuid,bigint) from public,anon,service_role;
grant execute on function public.card_chat_person(uuid,bigint) to authenticated;
