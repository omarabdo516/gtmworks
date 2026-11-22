-- #648: a question where several choices may be picked is answered from its card. Its person picks one or more of its
-- choices and sends them as one answer: the card keeps them as the choices' own texts, in the order they were offered
-- (a jsonb array in `answer`, where typed words stay a string), the closer hands them to the Engine as they are kept,
-- and the log row of an answer the Engine took names them. Typed words still answer it as written.
--
-- reply_card_valid takes the array (20270412000000's function, unchanged otherwise). answer_question takes the picks in
-- a new last argument, `picks`, which defaults to none: the previous app's calls, which never send it, mean what they
-- meant. The migration changes no row.

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
     and case jsonb_typeof(content->'answer')
      when 'string' then length(content->>'answer') between 1 and 20000 and btrim(content->>'answer',E' \t\r\n')<>''
      -- Several picks (#648): only on a question where several may be picked, each one of its choices, once.
      when 'array' then coalesce((content->>'multiple')::boolean,false) and jsonb_array_length(content->'answer')>=1
       and jsonb_typeof(content->'choices')='array' and (content->'choices') @> (content->'answer')
       and not exists(select 1 from jsonb_array_elements(content->'answer') a where jsonb_typeof(a)<>'string')
       and (select count(distinct a) from jsonb_array_elements(content->'answer') a)=jsonb_array_length(content->'answer')
      else false end
    else false end
   and public.reply_card_text(content->'question',4000)
   and jsonb_typeof(content->'multiple')='boolean'
   and case when jsonb_typeof(content->'choices')='array' then jsonb_array_length(content->'choices')<=4
    and not exists(select 1 from jsonb_array_elements(content->'choices') o where not coalesce(jsonb_typeof(o)='string'
     and length(o#>>'{}') between 1 and 1000 and btrim(o#>>'{}',E' \t\r\n')<>'',false)) else false end
  else false end
  when 'hand' then state in ('open','done') and case when jsonb_typeof(content)='object' then
   (select array_agg(k order by k) from jsonb_object_keys(content) k) in
    (array['app','line','rows'],array['app','line','rows','url'],array['app','line','note','rows'],array['app','line','note','rows','url'])
   and public.reply_card_text(content->'app',40)
   and public.reply_card_text(content->'line',160)
   and case when jsonb_typeof(content->'rows')='array' then jsonb_array_length(content->'rows')<=8
    and not exists(select 1 from jsonb_array_elements(content->'rows') r where not case when jsonb_typeof(r)='object' then
     (select array_agg(k order by k) from jsonb_object_keys(r) k)=array['label','value']
     and public.reply_card_text(r->'label',40) and public.reply_card_text(r->'value',240) else false end) else false end
   and (not content ? 'url' or coalesce(jsonb_typeof(content->'url')='string' and content->>'url' ~* '^https://[^[:space:]]+$' and length(content->>'url')<=2000,false))
   and (not content ? 'note' or public.reply_card_text(content->'note',240))
  else false end
  when 'permission' then case when jsonb_typeof(content)='object' then
   case (select array_agg(k order by k) from jsonb_object_keys(content) k)
    when array['choices','command','description'] then state in ('open','closed')
    when array['choice','choices','command','description'] then state in ('sending','decided','closed')
     and jsonb_typeof(content->'choice')='string' and content->'choices' ? (content->>'choice')
    else false end
   and jsonb_typeof(content->'description')='string' and length(content->>'description')<=4000
   and jsonb_typeof(content->'command')='string' and length(content->>'command')<=4000
   and btrim((content->>'description')||(content->>'command'),E' \t\r\n')<>''
   and case when jsonb_typeof(content->'choices')='array' then jsonb_array_length(content->'choices')<=3
    and content->'choices' ?& array['once','deny']
    and not exists(select 1 from jsonb_array_elements(content->'choices') o where not coalesce(o#>>'{}' in ('once','always','deny'),false))
    and (select count(distinct o) from jsonb_array_elements(content->'choices') o)=jsonb_array_length(content->'choices') else false end
  else false end
  when 'connect' then state in ('open','postponed') and case when jsonb_typeof(content)='object' then
   (select array_agg(k order by k) from jsonb_object_keys(content) k)=array['app','reason']
   and coalesce(jsonb_typeof(content->'app')='string' and content->>'app' ~ '^[a-z][a-z0-9_-]{0,63}$',false)
   and public.reply_card_text(content->'reason',200)
  else false end
 end,false);
$$;


drop function public.answer_question(uuid,uuid,bigint,int,text,uuid);
create function public.answer_question(c uuid, conversation uuid, card bigint, choice int, answer text, answer_key uuid, picks int[] default null) returns text
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked public.reply_cards; said jsonb;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into talk from public.conversations v where v.id=conversation and v.company_id=c;
 if not found or talk.person_id<>auth.uid() or not public.can_see_agent(c,talk.agent_id) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if answer_question.answer_key is null then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
 -- Picks name their card, and are the whole answer.
 if picks is not null and (card is null or choice is not null or answer is not null) then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
 if card is null then
  -- Typed words while a question is open are its answer, unless they are a message already queued under this key (a
  -- retried send whose first answer was lost): that turn starts after the Run, so claiming it too would send it twice.
  -- Under reserve_conversation_turn's lock, so the queue and the claim never both take one send.
  perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
  if exists(select 1 from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=answer_question.answer_key) then return 'none'; end if;
  -- Keys before addressees, as reserve_conversation_turn: a send already kept as a note stays that note, and one
  -- already claimed as the answer stays that answer.
  if exists(select 1 from public.conversation_notes n where n.conversation_id=conversation and n.send_key=answer_question.answer_key) then return 'none'; end if;
  if exists(select 1 from public.reply_cards r where r.conversation_id=conversation and r.kind='question' and r.answer_key=answer_question.answer_key) then return 'claimed'; end if;
  select * into asked from public.reply_cards r where r.conversation_id=conversation and r.kind='question' and r.state in ('open','sending')
   order by r.id limit 1 for update;
  if not found then return 'none'; end if;
  -- Only while a question waits: a note to a person ("@Sara …") stays a note, as reserve_conversation_turn makes it.
  if exists(select 1 from public.conversation_addressee(c,answer)) then return 'none'; end if;
 else
  select * into asked from public.reply_cards r where r.id=card and r.conversation_id=conversation and r.kind='question' for update;
  if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 end if;
 if asked.answer_key=answer_question.answer_key then return 'claimed'; end if;
 if asked.state<>'open' then return case when asked.state='closed' then 'closed' else 'taken' end; end if;
 -- A slower closer may have kept this question after another ended its Run: nothing waits for an answer any more, so it
 -- closes here rather than holding the Conversation's one open question for good.
 if exists(select 1 from public.conversation_run_ends u where u.conversation_id=conversation and u.run_id=asked.run_id) then
  update public.reply_cards set state='closed' where id=asked.id and state='open';
  return 'closed';
 end if;
 if picks is not null then
  -- One or more of a several-pick question's choices, each once, kept in the order they were offered.
  if not coalesce((asked.content->>'multiple')::boolean,false) or cardinality(picks)<1 or array_position(picks,null) is not null
   or exists(select 1 from unnest(picks) p where p<0 or p>=jsonb_array_length(asked.content->'choices'))
   or (select count(distinct p) from unnest(picks) p)<>cardinality(picks) then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
  said:=(select jsonb_agg(asked.content->'choices'->p order by p) from unnest(picks) p);
 elsif choice is not null then
  if (asked.content->>'multiple')::boolean or choice<0 or choice>=jsonb_array_length(asked.content->'choices') then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
  said:=asked.content->'choices'->choice;
 else
  if answer is null or btrim(answer,E' \t\r\n')='' or length(answer)>20000 then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
  said:=to_jsonb(answer);
 end if;
 if said is null or jsonb_typeof(said)='string' and (btrim(said#>>'{}',E' \t\r\n')='' or length(said#>>'{}')>20000) then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
 update public.reply_cards set state='sending',content=asked.content||jsonb_build_object('answer',said),answered_by=auth.uid(),answered_at=now(),
  answer_key=answer_question.answer_key where id=asked.id;
 return 'claimed';
end $$;
revoke all on function public.answer_question(uuid,uuid,bigint,int,text,uuid,int[]) from public,anon,service_role;
grant execute on function public.answer_question(uuid,uuid,bigint,int,text,uuid,int[]) to authenticated;
