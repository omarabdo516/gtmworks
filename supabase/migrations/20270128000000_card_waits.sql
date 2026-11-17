-- #146: a Card follows its chat. While the chat's question (#138) or handed step (#139, #140) waits on its person, every
-- Member who sees the Card reads that wait with the Card (`card_wait`, read as `wait:card_wait`), and the board draws the
-- Card under "Waiting on you" without changing its stage. One rule says when a reply card waits (`reply_card_waits`), for
-- the person's own list and for everyone's Card alike. The log rows of a draft, a review, an answer and a step done are
-- written on the chat's Card when the chat has one at that moment; a chat with no Card keeps them private, as before.
--
-- Only adds and replaces functions: no row is rewritten, and a row written before this keeps where it is. The previous
-- app version runs against it: waiting_list keeps its columns and branches (a question or a hand now names its chat's
-- Card, and that app opens the chat as before), the writers keep their arguments, results and grants, and that app reads
-- a row on a Card as a change to the Card.

-- Whether a reply card waits on its Conversation's person now: a question while its Run has not ended, a hand while its
-- person may still write and sees its Agent (as waiting_list since #138 and #140, judged for the person instead of the
-- caller). Read again by id, for a caller who is that person or sees the chat's Card; anyone else, and any forged row,
-- gets false.
create function public.reply_card_waits(card public.reply_cards) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.reply_cards r
  join public.conversations v on v.id=r.conversation_id and v.company_id=r.company_id
  where r.id=card.id and r.state='open' and public.is_member(v.company_id)
   and (v.person_id=auth.uid() or exists(select 1 from public.work_cards w where w.company_id=v.company_id and w.conversation_id=v.id and public.can_see_card(w.company_id,w.id)))
   and case r.kind
    when 'question' then not exists(select 1 from public.conversation_usage u where u.conversation_id=r.conversation_id and u.run_id=r.run_id)
    when 'hand' then exists(select 1 from public.members m where m.company_id=v.company_id and m.person_id=v.person_id and m.removed_at is null and m.role<>'viewer')
     and public.agent_visible_to(v.company_id,v.person_id,v.agent_id)
    else false end);
$$;
revoke all on function public.reply_card_waits(public.reply_cards) from public,anon,service_role;
grant execute on function public.reply_card_waits(public.reply_cards) to authenticated;

-- What a Card's chat waits for, read with the Card: its newest waiting question or hand, whose person it waits on and
-- its line, or null. Only the Card's id and Company count from the row it is given, a Card with no chat stops before
-- any membership lookup, and it answers for a Card the caller sees in their own Company only.
create function public.card_wait(card public.work_cards) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('person',v.person_id,'kind',r.kind,'title',case r.kind when 'question' then r.content->>'question' else r.title end)
 from public.work_cards w
 join public.conversations v on v.id=w.conversation_id and v.company_id=w.company_id
 join public.reply_cards r on r.conversation_id=v.id and r.company_id=v.company_id and r.kind in ('question','hand') and r.state='open'
 where w.conversation_id is not null and w.id=card.id and w.company_id=card.company_id and public.is_member(w.company_id)
  and public.can_see_card(w.company_id,w.id) and public.reply_card_waits(r)
 order by r.created_at desc, r.id desc limit 1;
$$;
revoke all on function public.card_wait(public.work_cards) from public,anon,service_role;
grant execute on function public.card_wait(public.work_cards) to authenticated;

-- As #140's, and a question and a hand wait by the one rule above and name their chat's Card, read under the caller's
-- own rules.
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
  select 'question'::text, q.id, q.content->>'question', ''::text, v.agent_name,
    (select w.id from public.work_cards w where w.company_id=c and w.conversation_id=q.conversation_id), q.conversation_id, q.created_at
   from public.reply_cards q
   join public.conversations v on v.id=q.conversation_id and v.company_id=q.company_id
   where q.company_id=c and q.kind='question' and v.person_id=auth.uid() and public.reply_card_waits(q)
  union all
  select 'hand'::text, h.id, h.title, ''::text, v.agent_name,
    (select w.id from public.work_cards w where w.company_id=c and w.conversation_id=h.conversation_id), h.conversation_id, h.created_at
   from public.reply_cards h
   join public.conversations v on v.id=h.conversation_id and v.company_id=h.company_id
   where h.company_id=c and h.kind='hand' and v.person_id=auth.uid() and public.reply_card_waits(h)
  union all
  select 'agent_key'::text, k.id, g.name, ''::text, ''::text, null::bigint, null::uuid, k.created_at
   from public.agent_key_waits k
   join public.hermes_agents g on g.company_id=k.company_id and g.id=k.agent_id
   where k.company_id=c and public.agent_key_waits_shown(c)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;

-- The one place a chat's log row is placed: on the chat's Card when it has one now, read by every Member who sees the
-- Card; otherwise on its Agent, private to its teller, as before. Called only by the writers below, as their owner.
create function public.log_chat_event(conversation uuid, actor uuid, actor_kind text, actor_name text, action text, details jsonb, teller uuid, origin text, origin_id bigint, at timestamptz) returns void
language plpgsql set search_path='' as $$
declare talk public.conversations; tied bigint;
begin
 select * into talk from public.conversations where id=conversation;
 select w.id into tied from public.work_cards w where w.company_id=talk.company_id and w.conversation_id=conversation;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
  values(talk.company_id,actor,actor_kind,actor_name,case when tied is null then 'agent' else 'card' end,tied,talk.agent_id,action,
   case when tied is null then details||jsonb_build_object('private',true,'teller',teller) else details end,origin,origin_id,at)
  on conflict (source,source_id) do nothing;
end $$;
revoke all on function public.log_chat_event(uuid,uuid,text,text,text,jsonb,uuid,text,bigint,timestamptz) from public,anon,authenticated,service_role;

-- As #139's, and the card shown is logged where log_chat_event places it.
create or replace function public.agent_show_card(conversation uuid, run text, call text, kind text, title text, content jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; kept public.reply_cards; opened text:=case when kind='hand' then 'open' else 'shown' end;
begin
 select * into kept from public.reply_cards r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 if found then return jsonb_build_object('state','shown','card',kept.id); end if;
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not public.may_show_reply_cards(talk.company_id,talk.agent_id,talk.person_id) then return jsonb_build_object('state','refused'); end if;
 if not (public.reply_card_text(to_jsonb(title),100) and public.reply_card_valid(kind,opened,content)) then return jsonb_build_object('state','invalid'); end if;
 insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state)
  values(talk.company_id,conversation,run,call,kind,title,content,opened)
  on conflict (conversation_id,run_id,call_id) do nothing returning * into kept;
 if kept.id is null then
  select * into kept from public.reply_cards r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 elsif kept.kind<>'hand' then
  perform public.log_chat_event(conversation,talk.agent_id,'agent',(select name from public.hermes_agents where id=talk.agent_id),'agent_card_shown',
   jsonb_build_object('card',jsonb_build_object('kind',kept.kind,'title',kept.title)||case when kept.kind='review' then
     (select jsonb_build_object('fine',count(*) filter (where i->'fine'='true'::jsonb),'edits',count(*) filter (where i->'fine'='false'::jsonb))
      from jsonb_array_elements(kept.content->'items') i) else '{}'::jsonb end),
   talk.person_id,'reply_cards',kept.id,kept.created_at);
 end if;
 return jsonb_build_object('state','shown','card',kept.id);
end $$;

-- As #138's guarded settle, and the answer is logged where log_chat_event places it.
create or replace function public.settle_question(card bigint, verdict text) returns text
language plpgsql security definer set search_path='' as $$
declare asked public.reply_cards;
begin
 if verdict is null or verdict not in ('answered','closed') then raise exception 'questionVerdictInvalid' using errcode='22023'; end if;
 select * into asked from public.reply_cards where id=card and kind='question' for update;
 if not found then return null; end if;
 -- Not only the first verdict counts any more (20270112's rule): a delivery the Engine took wins over a "gone" another
 -- closer settled first, or over the Run's end closing the card before its closer settled it. The answer did reach the
 -- Engine, so the card reads answered and is logged once. A closed verdict never undoes an answered one.
 if not (asked.state='sending' or verdict='answered' and asked.state='closed' and asked.content ? 'answer') then return asked.state; end if;
 update public.reply_cards set state=verdict where id=asked.id;
 if verdict='answered' then
  perform public.log_chat_event(asked.conversation_id,asked.answered_by,'person',(select name from public.people where id=asked.answered_by),'agent_question_answered',
   jsonb_build_object('question',jsonb_build_object('text',asked.content->'question','answer',asked.content->'answer')),
   asked.answered_by,'reply_card_answers',asked.id,asked.answered_at);
 end if;
 return verdict;
end $$;

-- As #140's, and "Done it" is logged where log_chat_event places it.
create or replace function public.mark_hand_done(c uuid, conversation uuid, card bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; handed public.reply_cards; writer text;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into talk from public.conversations v where v.id=conversation and v.company_id=c;
 if not found or talk.person_id<>auth.uid() or not public.can_see_agent(c,talk.agent_id) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation_turn:'||conversation::text,0));
 select * into handed from public.reply_cards r where r.id=card and r.conversation_id=conversation and r.kind='hand' for update;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if handed.state='done' then return jsonb_build_object('state','done','at',handed.done_at,'first',false); end if;
 update public.reply_cards set state='done',done_by=auth.uid(),done_at=now() where id=handed.id returning * into handed;
 select name into writer from public.people where id=auth.uid();
 perform public.log_chat_event(conversation,auth.uid(),'person',writer,'agent_hand_done',
  jsonb_build_object('hand',jsonb_build_object('title',handed.title)),auth.uid(),'reply_card_answers',handed.id,handed.done_at);
 insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message,hand_card)
  values(conversation,gen_random_uuid(),talk.company_id,auth.uid(),talk.agent_id,public.hand_turn_message(writer,handed.title,handed.content->>'app',handed.done_at),handed.id);
 return jsonb_build_object('state','done','at',handed.done_at,'first',true);
end $$;
