-- #651: a channel's question where several choices may be picked is answered from its card, as a Conversation's is (#648).
-- The worker now keeps its card rather than answering it empty (#354); a Member who may answer picks one or more of its
-- choices and sends them as one answer, which the card keeps as the choices' own texts in the order they were offered
-- (reply_card_valid takes them since 20270415999955), the closer hands them to the Engine as they are kept, and the
-- answer's log row names them. Typed words are still not taken in a channel.
--
-- answer_channel_question takes the picks in a new last argument, `picks`, which defaults to none: the previous app's
-- calls, which never send it, mean what they meant. track_channel_question hands each answer over as it is kept, a jsonb
-- string or array, where it handed the text: a kept string reads the same to the worker either way. No row changes.

-- 20270415999960's track_channel_question, handing over the answer as it is kept.
create or replace function public.track_channel_question(message bigint, run text, asking jsonb, ended boolean, read_started_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare called public.channel_runs; m public.channel_messages; asked text:=asking->>'id'; kept jsonb; main boolean; words text:=public.words_of(asking);
begin
 perform pg_advisory_xact_lock(hashtextextended('channel_question:'||message::text||':'||coalesce(run,''),0));
 select * into called from public.channel_runs where message_id=message and run_id=run;
 if not found then return '[]'::jsonb; end if;
 select * into m from public.channel_messages where id=message;
 if m.id is null or m.author<>'person' then return '[]'::jsonb; end if;
 update public.reply_cards r set state='closed' where r.channel_message_id=message and r.run_id=run and r.kind='question'
  and r.state='open' and (ended or (r.call_id is distinct from asked and r.created_at<read_started_at));
 if asked is not null and not ended and called.outcome is null then
  kept:=jsonb_build_object('question',asking->'text','choices',asking->'choices','multiple',asking->'multiple');
  if length(asked) between 1 and 200 and public.reply_card_valid('question','open',kept) then
   main:=coalesce((select a.is_default from public.hermes_agents a where a.id=called.agent_id),false);
   insert into public.reply_cards(company_id,channel_message_id,channel_ordinal,run_id,call_id,kind,title,content,state,created_at,addressed_to,said_before)
    values(called.company_id,message,called.ordinal,run,asked,'question',
     case when length(kept->>'question')<=100 then kept->>'question' else rtrim(left(kept->>'question',99),E' \t\r\n')||'…' end,
     kept,'open',read_started_at,case when main then m.person_id end,
     case when not public.channel_run_said(message,run,words) then words end)
    on conflict do nothing;
   update public.reply_cards r set said_before=words where r.channel_message_id=message and r.run_id=run and r.kind='question' and r.call_id=asked and r.said_before is null
    and not public.channel_run_said(message,run,words);
  end if;
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('card',r.id,'question',r.call_id,'answer',r.content->'answer') order by r.id)
  from public.reply_cards r where r.channel_message_id=message and r.run_id=run and r.kind='question' and r.state='sending'),'[]'::jsonb);
end $$;
revoke all on function public.track_channel_question(bigint,text,jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.track_channel_question(bigint,text,jsonb,boolean,timestamptz) to service_role;

-- 20270327000000's answer_channel_question, with the picks.
drop function public.answer_channel_question(uuid,uuid,bigint,int,text,uuid);
create function public.answer_channel_question(c uuid, channel uuid, card bigint, choice int, answer text, answer_key uuid, picks int[] default null) returns text
language plpgsql security definer set search_path='' as $$
declare asked public.reply_cards; m public.channel_messages; said jsonb;
begin
 if not public.conversation_can_write(c) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if answer_key is null then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
 -- Picks are the whole answer.
 if picks is not null and (choice is not null or answer is not null) then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
 select * into asked from public.reply_cards r where r.id=card and r.kind='question' and r.channel_message_id is not null for update;
 if not found then raise exception 'channelNotFound' using errcode='P0002'; end if;
 select * into m from public.channel_messages where id=asked.channel_message_id;
 if m.id is null or m.company_id<>c or m.channel_id<>channel or not public.in_channel(channel) then
  raise exception 'channelNotFound' using errcode='P0002'; end if;
 if asked.addressed_to is not null and asked.addressed_to<>auth.uid() then
  raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if asked.answer_key=answer_key then return 'claimed'; end if;
 if asked.state<>'open' then return case when asked.state='closed' then 'closed' else 'taken' end; end if;
 if not exists(select 1 from public.channel_runs r where r.message_id=asked.channel_message_id
  and r.ordinal=coalesce(asked.channel_ordinal,1) and r.outcome is null) then
  update public.reply_cards set state='closed' where id=asked.id and state='open'; return 'closed'; end if;
 if picks is not null then
  -- One or more of a several-pick question's choices, each once, kept in the order they were offered.
  if not coalesce((asked.content->>'multiple')::boolean,false) or cardinality(picks)<1 or array_position(picks,null) is not null
   or exists(select 1 from unnest(picks) p where p<0 or p>=jsonb_array_length(asked.content->'choices'))
   or (select count(distinct p) from unnest(picks) p)<>cardinality(picks) then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
  -- Two choices may read alike: each text is kept once, at its first pick, so the card stays one reply_card_valid keeps.
  said:=(select jsonb_agg(text order by first) from (select asked.content->'choices'->p as text,min(p) as first from unnest(picks) p group by 1) picked);
 elsif choice is not null then
  if coalesce((asked.content->>'multiple')::boolean,false) or choice<0 or choice>=jsonb_array_length(asked.content->'choices') then
   raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
  said:=asked.content->'choices'->choice;
 else
  said:=to_jsonb(answer);
 end if;
 if said is null or jsonb_typeof(said)='string' and (btrim(said#>>'{}',E' \t\r\n')='' or length(said#>>'{}')>20000) then
  raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
 update public.reply_cards set state='sending',content=asked.content||jsonb_build_object('answer',said),answered_by=auth.uid(),
  answered_at=now(),answer_key=answer_channel_question.answer_key where id=asked.id;
 return 'claimed';
end $$;
revoke all on function public.answer_channel_question(uuid,uuid,bigint,int,text,uuid,int[]) from public,anon,service_role;
grant execute on function public.answer_channel_question(uuid,uuid,bigint,int,text,uuid,int[]) to authenticated;
