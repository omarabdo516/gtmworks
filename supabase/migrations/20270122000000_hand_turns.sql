-- #140: after #139's "Done it" the Agent picks up from there. The first press, in the same transaction as it marks the
-- card done, queues one turn of the Conversation's person whose message tells the Agent who did the step and when; the
-- existing queue then reserves, pins, retries and starts it as every turn (claim_conversation_turn,
-- record_conversation_turn), behind an open Run when there is one, and only its person or an Owner or a Manager stops it
-- (conversation_stop_target). The turn names its card (`hand_card`), so the record draws no bubble of the person for it.
-- An open hand card also waits in its person's "Waiting on you", derived from the card, so a typed message never clears
-- it and "Done it" alone does.
--
-- Nothing existing is rewritten: the new columns are empty on every queued turn and message there, and waiting_list keeps every branch
-- it had. The previous app version runs against this: it selects its columns by name, its "Done it" now also queues the
-- turn its queue starts (drawn there as the person's message, a plain sentence), and it draws the new waiting item as a
-- plain one, its title and Agent, opening the Conversation.

-- The one link between a turn and the hand card it picks up from: at most one turn per card, a card of the turn's own
-- Conversation. The person's message the turn becomes names the card too, set as it is stored, so every reader of the
-- messages tells that turn by its own row. A card that is ever removed leaves the turn and its message as plain ones.
create unique index reply_cards_conversation_key on public.reply_cards(id,conversation_id);
alter table public.conversation_queued_turns add column hand_card bigint,
 add foreign key (hand_card,conversation_id) references public.reply_cards(id,conversation_id) on delete set null (hand_card);
create unique index conversation_queued_turns_one_per_hand on public.conversation_queued_turns(hand_card) where hand_card is not null;
alter table public.conversation_messages add column hand_card bigint,
 add foreign key (hand_card,conversation_id) references public.reply_cards(id,conversation_id) on delete set null (hand_card);

create function public.conversation_message_hand_card() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.hand_card:=(select q.hand_card from public.conversation_queued_turns q where q.conversation_id=new.conversation_id and q.send_key=new.send_key);
 return new;
end $$;
revoke all on function public.conversation_message_hand_card() from public,anon,authenticated,service_role;
create trigger conversation_message_hand_card before insert on public.conversation_messages for each row when (new.author='person' and new.send_key is not null)
 execute function public.conversation_message_hand_card();

-- What the Agent is told: who did the step, which one, in which app and when (UTC, as the Engine reads times).
create function public.hand_turn_message(writer text, title text, app text, at timestamptz) returns text language sql immutable set search_path='' as $$
 select format('%s did the step you handed over, "%s" in %s, and pressed "Done it" at %s UTC. Pick up from there.',
  writer,title,app,to_char(at at time zone 'UTC','YYYY-MM-DD HH24:MI'));
$$;
revoke all on function public.hand_turn_message(text,text,text,timestamptz) from public,anon,authenticated,service_role;

-- As #139's, and the first press also queues the person's turn that tells the Agent, under the Conversation's turn lock
-- taken before the card's row (the order reserve_conversation_turn and claim_conversation_turn keep). It is queued
-- directly, never through reserve_conversation_turn, whose addressee reading would make a title holding "@Name" a note.
-- A later press queues nothing.
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
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(handed.company_id,auth.uid(),'person',writer,'agent',talk.agent_id,'agent_hand_done',
   jsonb_build_object('hand',jsonb_build_object('title',handed.title),'private',true,'teller',auth.uid()),'reply_card_answers',handed.id,handed.done_at)
  on conflict (source,source_id) do nothing;
 insert into public.conversation_queued_turns(conversation_id,send_key,company_id,person_id,agent_id,message,hand_card)
  values(conversation,gen_random_uuid(),talk.company_id,auth.uid(),talk.agent_id,public.hand_turn_message(writer,handed.title,handed.content->>'app',handed.done_at),handed.id);
 return jsonb_build_object('state','done','at',handed.done_at,'first',true);
end $$;

-- As #138's, and an open hand card waits on its Conversation's person while they may still write and see its Agent: no
-- Viewer has one, and it stays until "Done it", whatever is written meanwhile or however its Run ended.
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
    and not exists(select 1 from public.conversation_usage u where u.conversation_id=q.conversation_id and u.run_id=q.run_id)
  union all
  select 'hand'::text, h.id, h.title, ''::text, v.agent_name, null::bigint, h.conversation_id, h.created_at
   from public.reply_cards h
   join public.conversations v on v.id=h.conversation_id and v.company_id=h.company_id
   where h.company_id=c and h.kind='hand' and h.state='open' and v.person_id=auth.uid()
    and public.conversation_can_write(c) and public.can_see_agent(c,v.agent_id)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;
