-- An answer claimed for a Run's question is delivered once (#138): every closer (the answer's own request, the page's
-- read of its Conversation, the worker) used to be handed every claim still sending, so two at once asked the Engine
-- twice. A claim is now handed to one closer at a time; the column is new and empty, so nothing already kept changes,
-- and the previous app calls the function as before.
alter table public.reply_cards add column delivering_at timestamptz;

create or replace function public.track_run_question(conversation uuid, run text, asking jsonb, ended boolean, read_started_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked text:=asking->>'id'; kept jsonb; handed jsonb;
begin
 -- The lock a Run's end takes (close_ended_run_questions), so a question is never kept after its Run has ended.
 perform pg_advisory_xact_lock(hashtextextended('question_run:'||conversation::text||':'||run,0));
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run) then return '[]'::jsonb; end if;
 -- Closed first, so the next question is kept on the read that shows it (one open question per Conversation).
 -- Another Run's question that outlived its end, open or claimed (left from before a Run's end closed its questions),
 -- closes here too, its claimed answer kept, so it no longer holds the Conversation's one open question.
 update public.reply_cards r set state='closed' where r.conversation_id=conversation and r.kind='question'
  and (r.state='open' and r.run_id=run and (ended or (r.call_id is distinct from asked and r.created_at<read_started_at))
   or r.state in ('open','sending') and r.run_id<>run and exists(select 1 from public.conversation_usage u where u.conversation_id=conversation and u.run_id=r.run_id));
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
 -- Each claimed answer is handed to this closer alone, for 15 seconds (an answer's call to the Engine gives up after 10):
 -- another closer's read meanwhile gets nothing to deliver, so the Engine is asked once; a closer that died or could not
 -- reach the Engine leaves it to the first read after that.
 with given as (
  update public.reply_cards r set delivering_at=now()
   where r.conversation_id=conversation and r.run_id=run and r.kind='question' and r.state='sending'
    and (r.delivering_at is null or r.delivering_at<now()-interval '15 seconds')
   returning r.id,r.call_id,r.content)
 select jsonb_agg(jsonb_build_object('card',g.id,'question',g.call_id,'answer',g.content->'answer') order by g.id) into handed from given g;
 return coalesce(handed,'[]'::jsonb);
end $$;
