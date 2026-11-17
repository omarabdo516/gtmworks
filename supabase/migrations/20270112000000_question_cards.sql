-- #138: the question card, the third kind of reply card (#136). An Agent asks its person with the Engine's own clarify
-- tool; the Run waits for the answer. One reply_cards row of kind question per asked question: its call_id is the
-- driver's opaque question id, and `state` is the only record of its life: open (asked), sending (the person's answer is
-- claimed and stored), then answered (the Engine took it) or closed (the Engine stopped waiting: its own time limit, a
-- stop, the Run's end). A sending card is the person's answer, drawn as answered.
--
-- Three functions own every transition: track_run_question (whoever closes Runs, on each read), answer_question (the
-- Conversation's person, the one claim) and settle_question (whoever delivered the answer). The open question waits in
-- the person's "Waiting on you", derived from the card, so nothing has to be resolved; its answer is logged privately,
-- as #136's card is. The tool table gains clarify at every level, policy 3.
--
-- Nothing existing is rewritten: the draft and review branches are unchanged and every new column is empty on the rows
-- there. The previous app version runs against this: its reader leaves out a question row and it never calls the new
-- functions; until its worker is replaced it cannot record a profile under policy 3, as at every policy change.

-- What each kind holds and which states it takes. Branches are only ever added: the table's check does not judge stored
-- rows again when this is replaced, so a kind's branch must never get narrower. A question's choices are the Engine's
-- texts as given (sent back exactly, so never trimmed here), none for an open-ended one; its answer is what the person
-- picked or typed, kept from the claim on.
create or replace function public.reply_card_valid(kind text, state text, content jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(case kind
  when 'draft' then state='shown' and case when jsonb_typeof(content)='object' then
   (select array_agg(k order by k) from jsonb_object_keys(content) k)=array['line','rows']
   and public.reply_card_text(content->'line',160)
   and case when jsonb_typeof(content->'rows')='array' then jsonb_array_length(content->'rows')<=8
    and not exists(select 1 from jsonb_array_elements(content->'rows') r where not case when jsonb_typeof(r)='object' then
     (select array_agg(k order by k) from jsonb_object_keys(r) k)=array['label','value']
     and public.reply_card_text(r->'label',40) and public.reply_card_text(r->'value',240) else false end) else false end
  else false end
  when 'review' then state='shown' and case when jsonb_typeof(content)='object' then
   (select array_agg(k order by k) from jsonb_object_keys(content) k)=array['decision','items','line']
   and public.reply_card_text(content->'line',160)
   and public.reply_card_text(content->'decision',160)
   and case when jsonb_typeof(content->'items')='array' then jsonb_array_length(content->'items') between 1 and 8
    and not exists(select 1 from jsonb_array_elements(content->'items') i where not case when jsonb_typeof(i)='object' then
     (select array_agg(k order by k) from jsonb_object_keys(i) k)=array['fine','note','text']
     and jsonb_typeof(i->'fine')='boolean'
     and public.reply_card_text(i->'text',240) and public.reply_card_text(i->'note',240) else false end) else false end
  else false end
  when 'question' then case when jsonb_typeof(content)='object' then
   case (select array_agg(k order by k) from jsonb_object_keys(content) k)
    when array['choices','multiple','question'] then state in ('open','closed')
    when array['answer','choices','multiple','question'] then state in ('sending','answered','closed')
     and jsonb_typeof(content->'answer')='string' and length(content->>'answer') between 1 and 20000 and btrim(content->>'answer',E' \t\r\n')<>''
    else false end
   and public.reply_card_text(content->'question',4000)
   and jsonb_typeof(content->'multiple')='boolean'
   and case when jsonb_typeof(content->'choices')='array' then jsonb_array_length(content->'choices')<=4
    and not exists(select 1 from jsonb_array_elements(content->'choices') o where not coalesce(jsonb_typeof(o)='string'
     and length(o#>>'{}') between 1 and 1000 and btrim(o#>>'{}',E' \t\r\n')<>'',false)) else false end
  else false end
 end,false);
$$;

-- Who answered, when, and the key of the request that claimed it (the same request again finds its own claim). A card
-- holds them exactly when it holds an answer.
alter table public.reply_cards add column answered_by uuid references public.people(id), add column answered_at timestamptz, add column answer_key uuid;
alter table public.reply_cards add constraint reply_cards_answer check ((answered_by is null)=(answered_at is null) and (answered_at is null)=(answer_key is null)
 and (answered_at is not null)=(kind='question' and content ? 'answer'));
-- A Conversation waits on at most one question at a time, as the Engine asks them one at a time.
create unique index reply_cards_one_question on public.reply_cards(conversation_id) where kind='question' and state in ('open','sending');

-- Whoever closes a Run (the worker, a reader of the Conversation, the stop route) tells the database what each read of
-- it showed: the question it asks (`asking`, {id,text,choices,multiple}, or null), whether it has ended, and when the
-- read began. The question is kept once. An open card of the Run closes when the Run has ended, or when a read that
-- began after the card was kept no longer asks it (a read that began earlier may predate it); an open card of a Run
-- the record has closed closes too. It answers the Run's claimed answers still to deliver.
create function public.track_run_question(conversation uuid, run text, asking jsonb, ended boolean, read_started_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked text:=asking->>'id'; kept jsonb;
begin
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run) then return '[]'::jsonb; end if;
 -- Closed first, so the next question is kept on the read that shows it (one open question per Conversation).
 update public.reply_cards r set state='closed' where r.conversation_id=conversation and r.kind='question' and r.state='open'
  and (r.run_id=run and (ended or (r.call_id is distinct from asked and r.created_at<read_started_at))
   or r.run_id<>run and exists(select 1 from public.conversation_usage u where u.conversation_id=conversation and u.run_id=r.run_id));
 if asked is not null and not ended then
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
revoke all on function public.track_run_question(uuid,text,jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.track_run_question(uuid,text,jsonb,boolean,timestamptz) to service_role;

-- The one claim, by the Conversation's own person (never a Viewer, who writes nothing): a pick sends the choice's
-- index and stores the Engine's own text of it, typed words are stored as written. With no card it means the open
-- question, if any (a typed message). The same answer key again is the same claim; any other claim of an answered card
-- is taken, and of one the Engine stopped waiting for, closed.
create function public.answer_question(c uuid, conversation uuid, card bigint, choice int, answer text, answer_key uuid) returns text
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
revoke all on function public.answer_question(uuid,uuid,bigint,int,text,uuid) from public,anon,service_role;
grant execute on function public.answer_question(uuid,uuid,bigint,int,text,uuid) to authenticated;

-- What became of a delivered answer: answered (the Engine took it) or closed (it no longer waited). Only the first
-- verdict counts, and only an answered one is logged, once: who answered, the question and the answer, private to its
-- person and the Company's Owners and Managers, as #136's card is.
create function public.settle_question(card bigint, verdict text) returns text
language plpgsql security definer set search_path='' as $$
declare asked public.reply_cards;
begin
 if verdict is null or verdict not in ('answered','closed') then raise exception 'questionVerdictInvalid' using errcode='22023'; end if;
 select * into asked from public.reply_cards where id=card and kind='question' for update;
 if not found then return null; end if;
 if asked.state<>'sending' then return asked.state; end if;
 update public.reply_cards set state=verdict where id=asked.id;
 if verdict='answered' then
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
   values(asked.company_id,asked.answered_by,'person',(select name from public.people where id=asked.answered_by),'agent',
    (select v.agent_id from public.conversations v where v.id=asked.conversation_id),'agent_question_answered',
    jsonb_build_object('question',jsonb_build_object('text',asked.content->'question','answer',asked.content->'answer'),'private',true,'teller',asked.answered_by),
    'reply_card_answers',asked.id,asked.answered_at)
   on conflict (source,source_id) do nothing;
 end if;
 return verdict;
end $$;
revoke all on function public.settle_question(bigint,text) from public,anon,authenticated;
grant execute on function public.settle_question(bigint,text) to service_role;

alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit','note_runs','reply_cards','member_invitations','reply_card_answers'));

-- 20261223000000's list, and an open question of the reader's own Conversation (#138), read under reply_cards_read: it
-- names its Agent and opens its Conversation, and leaves the list once answered or closed.
create or replace function public.waiting_list(c uuid)
returns table(kind text, id bigint, title text, body text, asked_by text, card_id bigint, conversation_id uuid, created_at timestamptz)
language sql stable set search_path='' as $$
 select * from (
  select 'approval'::text, w.id, w.title, coalesce(a.name,''), ''::text, w.id, null::uuid, coalesce(w.review_entered_at,w.created_at)
   from public.work_cards w
   join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id and s.kind='review'
   left join public.approval_steps a on a.company_id=w.company_id and a.id=w.approval_step_id
   where w.company_id=c and w.approval_step_id is not null and public.approval_holds(c,w.approval_step_id)
  union all
  select i.kind, i.id, i.title, i.body, i.asked_by, i.card_id, i.conversation_id, i.created_at
   from public.waiting_items i where i.company_id=c and i.person_id=auth.uid() and i.resolved_at is null
  union all
  select 'agent_request'::text, r.id, r.agent_name, r.job, coalesce(p.name,''), null::bigint, null::uuid, r.created_at
   from public.lead_agent_requests r
   join public.members m on m.company_id=r.company_id and m.person_id=r.asked_by and m.removed_at is null
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and r.state='waiting' and public.is_company_owner(c)
  union all
  select 'question'::text, q.id, q.content->>'question', ''::text, v.agent_name, null::bigint, q.conversation_id, q.created_at
   from public.reply_cards q
   join public.conversations v on v.id=q.conversation_id and v.company_id=q.company_id
   where q.company_id=c and q.kind='question' and q.state='open' and v.person_id=auth.uid()
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;

-- Policy 3: clarify at every level (lib/agent-levels.mjs). The worker applies it to every profile on another policy.
create or replace function public.engine_tool_policy() returns integer language sql immutable set search_path='' as $$ select 3 $$;
