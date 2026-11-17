-- #138, reviews of #295 and #300: a question ends with its Run, and typed words that are a note stay a note.
-- A Run's end (its conversation_usage row) closes its questions that are still open or claimed, in that transaction:
-- nothing can deliver an answer to an ended Run, so a claimed one closes with the answer kept (drawn "not delivered"),
-- and the Conversation's one open question is free again. track_run_question takes the same per-Run lock, so a slower
-- closer's read never keeps a question after its Run has ended. answer_question's row lock orders a claim against it.
--
-- No row is rewritten: a question left open for an ended Run before this closes when someone answers it. The previous
-- app version runs against this: it already reads 'none' as "not an answer" and 'closed' as "can no longer be
-- answered", and a closed card as closed.

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
  -- Keys before addressees, as reserve_conversation_turn: a send already claimed as the answer stays that answer, and
  -- otherwise a note to a person ("@Sara …") stays a note, as reserve_conversation_turn makes it, never the answer.
  if exists(select 1 from public.reply_cards r where r.conversation_id=conversation and r.kind='question' and r.answer_key=answer_question.answer_key) then return 'claimed'; end if;
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

create or replace function public.track_run_question(conversation uuid, run text, asking jsonb, ended boolean, read_started_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked text:=asking->>'id'; kept jsonb;
begin
 -- The lock a Run's end takes (close_ended_run_questions), so a question is never kept after its Run has ended.
 perform pg_advisory_xact_lock(hashtextextended('question_run:'||conversation::text||':'||run,0));
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run) then return '[]'::jsonb; end if;
 -- Closed first, so the next question is kept on the read that shows it (one open question per Conversation).
 update public.reply_cards r set state='closed' where r.conversation_id=conversation and r.kind='question' and r.state='open'
  and (r.run_id=run and (ended or (r.call_id is distinct from asked and r.created_at<read_started_at))
   or r.run_id<>run and exists(select 1 from public.conversation_usage u where u.conversation_id=conversation and u.run_id=r.run_id));
 -- A read that saw the question before another closer ended the Run keeps nothing for it.
 if asked is not null and not ended and not exists(select 1 from public.conversation_usage u where u.conversation_id=conversation and u.run_id=run) then
  kept:=jsonb_build_object('question',asking->'text','choices',asking->'choices','multiple',asking->'multiple');
  if length(asked) between 1 and 200 and public.reply_card_valid('question','open',kept) then
   insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at)
    values(talk.company_id,conversation,run,asked,'question',
     case when length(kept->>'question')<=100 then kept->>'question' else rtrim(left(kept->>'question',99),E' \t\r\n')||'…' end,kept,'open',read_started_at)
    on conflict do nothing;
  end if;
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('card',r.id,'question',r.call_id,'answer',r.content->'answer') order by r.id) from public.reply_cards r
  where r.conversation_id=conversation and r.run_id=run and r.kind='question' and r.state='sending'),'[]'::jsonb);
end $$;

create function public.close_ended_run_questions() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('question_run:'||new.conversation_id::text||':'||new.run_id,0));
 update public.reply_cards set state='closed' where conversation_id=new.conversation_id and run_id=new.run_id and kind='question' and state in ('open','sending');
 return null;
end $$;
revoke all on function public.close_ended_run_questions() from public,anon,authenticated,service_role;
create trigger conversation_usage_closes_questions after insert on public.conversation_usage for each row execute function public.close_ended_run_questions();
