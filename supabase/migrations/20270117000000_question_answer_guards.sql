-- #138, review of #295: two guards on answering a question, and nothing else changes. Typed words that are a note to a
-- person stay a note. A question kept for a Run that has already ended (a slower closer's read) is closed when someone
-- answers it, instead of holding the Conversation's one open question with an answer that can never be delivered.
--
-- No row is rewritten. The previous app version runs against this: it already reads 'none' as "not an answer" and
-- 'closed' as "can no longer be answered".

create or replace function public.answer_question(c uuid, conversation uuid, card bigint, choice int, answer text, answer_key uuid) returns text
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked public.reply_cards; said text;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into talk from public.conversations v where v.id=conversation and v.company_id=c;
 if not found or talk.person_id<>auth.uid() or not public.can_see_agent(c,talk.agent_id) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if answer_question.answer_key is null then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
 if card is null then
  -- Typed words while a question is open are its answer, unless they are a message already queued under this key (a
  -- retried send whose first answer was lost): that turn starts after the Run, so claiming it too would send it twice.
  -- Under reserve_conversation_turn's lock, so the queue and the claim never both take one send.
  perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
  if exists(select 1 from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=answer_question.answer_key) then return 'none'; end if;
  -- A note to a person ("@Sara …") stays a note, as reserve_conversation_turn makes it, and is never the answer.
  if exists(select 1 from public.conversation_addressee(c,answer)) then return 'none'; end if;
  select * into asked from public.reply_cards r where r.conversation_id=conversation and r.kind='question'
   and (r.state in ('open','sending') or r.answer_key=answer_question.answer_key)
   order by r.answer_key is not distinct from answer_question.answer_key desc, r.id limit 1 for update;
  if not found then return 'none'; end if;
 else
  select * into asked from public.reply_cards r where r.id=card and r.conversation_id=conversation and r.kind='question' for update;
  if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 end if;
 if asked.answer_key=answer_question.answer_key then return 'claimed'; end if;
 if asked.state<>'open' then return case when asked.state='closed' then 'closed' else 'taken' end; end if;
 -- A slower closer may have kept this question after another ended its Run: nothing waits for an answer any more, so it
 -- closes here rather than holding the Conversation's one open question for good.
 if exists(select 1 from public.conversation_usage u where u.conversation_id=conversation and u.run_id=asked.run_id) then
  update public.reply_cards set state='closed' where id=asked.id and state='open';
  return 'closed';
 end if;
 if choice is not null then
  if (asked.content->>'multiple')::boolean or choice<0 or choice>=jsonb_array_length(asked.content->'choices') then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
  said:=asked.content->'choices'->>choice;
 else
  said:=answer;
 end if;
 if said is null or btrim(said,E' \t\r\n')='' or length(said)>20000 then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
 update public.reply_cards set state='sending',content=asked.content||jsonb_build_object('answer',said),answered_by=auth.uid(),answered_at=now(),
  answer_key=answer_question.answer_key where id=asked.id;
 return 'claimed';
end $$;
