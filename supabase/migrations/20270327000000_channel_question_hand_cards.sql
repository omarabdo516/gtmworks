-- #149: in a channel, the two cards that wait on people work as a team's: a question the Engine asks in a channel Run
-- (#138's contract call) and a step handed over with hand_over (#139). Any Member of the channel who may write answers
-- or presses "Done it", and the first one wins for everyone: the question keeps the answer it was given and its card
-- reads answered, the step keeps who did it and when, and a second action by anyone changes nothing. A Viewer reads the
-- same card with no buttons.
--
-- The main Agent's own one question (#143) is addressed to the Member whose message the Run answers: only that Member is
-- offered its chips, and the database refuses everyone else. Any other Agent's question is the whole team's.
--
-- A question or a handed step in a channel is one item in "Waiting on you" for every Member of that channel who may
-- write, and it leaves all of them when one acts. Someone outside the channel reads no card and no item, and the answer's
-- or the step's log row is read by the channel's members only.
--
-- Additive only: one column on reply_cards (who a question is addressed to) and one on channel_messages (the quiet
-- message that asks the Agent to pick up after "Done it"), the question's three functions and the hand's one, pin_channel_run
-- and channel_show_card from their latest definitions with the handed step added, waiting_list with the two channel
-- branches, and company_log_read with the answer's rows. No row is rewritten, and the previous app version runs against
-- this: it never offers hand_over in a channel, never calls the new functions and reads reply_cards by its own columns.

-- Which Member a channel's question is addressed to: set for the main Agent's question alone, which only that Member may
-- answer (#143). Any other question of a channel is null: every Member who may write there answers it.
alter table public.reply_cards add column addressed_to uuid references public.people(id);
alter table public.reply_cards add constraint reply_cards_addressed check
 (addressed_to is null or kind='question' and channel_message_id is not null);

-- The message "Done it" writes to ask its Agent to pick up (#140): the presser's own, with the step's card. Nothing draws
-- it as a message: the card shows the time and the Agent's reply follows.
alter table public.channel_messages add column hand_card bigint references public.reply_cards(id) on delete set null;
grant select (hand_card) on public.channel_messages to authenticated;

-- 20261227000000's channel_sidebar, and the quiet message "Done it" writes (#140) is never new: the transcript draws
-- nothing of it, so a badge that counted it would point at no message. The Agent's reply that follows it is an ordinary
-- message and still counts.
create or replace function public.channel_sidebar(c uuid) returns table(id uuid, kind text, name text, unread integer)
language sql stable security definer set search_path='' as $$
 select k.id, k.kind, k.name, (select count(*)::int from public.channel_messages m where m.channel_id=k.id
   and m.person_id is distinct from auth.uid() and m.hand_card is null
   and m.id > greatest(coalesce((select r.read_through from public.channel_reads r where r.channel_id=k.id and r.person_id=auth.uid()),0),
                       coalesce((select p.joined_through from public.channel_people p where p.channel_id=k.id and p.person_id=auth.uid()),0)))
 from public.channels k
 where k.company_id=c and auth.uid() is not null and public.in_channel(k.id)
 order by k.kind='general' desc, k.created_at, k.id;
$$;

-- A channel Run's question, kept once as a reply card linked to the message whose Run asks it, with the place of that
-- Run: the card is drawn under the Member's message, before the Agent's reply, as its requests are (#165). `asking` is
-- the Engine's question ({id,text,choices,multiple}) or null. A read that began after the card was kept and no longer
-- asks it closes it, and so does the Run's end. It answers the claimed answers still to deliver.
create function public.track_channel_question(message bigint, run text, asking jsonb, ended boolean, read_started_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare called public.channel_runs; m public.channel_messages; asked text:=asking->>'id'; kept jsonb; main boolean;
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
   insert into public.reply_cards(company_id,channel_message_id,channel_ordinal,run_id,call_id,kind,title,content,state,created_at,addressed_to)
    values(called.company_id,message,called.ordinal,run,asked,'question',
     case when length(kept->>'question')<=100 then kept->>'question' else rtrim(left(kept->>'question',99),E' \t\r\n')||'…' end,
     kept,'open',read_started_at,case when main then m.person_id end)
    on conflict do nothing;
  end if;
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('card',r.id,'question',r.call_id,'answer',r.content->>'answer') order by r.id)
  from public.reply_cards r where r.channel_message_id=message and r.run_id=run and r.kind='question' and r.state='sending'),'[]'::jsonb);
end $$;
revoke all on function public.track_channel_question(bigint,text,jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.track_channel_question(bigint,text,jsonb,boolean,timestamptz) to service_role;

-- A Run's end closes its own questions, open or claimed, in that transaction: nothing can deliver an answer to an ended
-- Run, so a claimed one closes with the answer kept, and none waits in a list any more.
create function public.close_ended_channel_questions() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('channel_question:'||new.message_id::text||':'||coalesce(new.run_id,''),0));
 update public.reply_cards set state='closed'
  where channel_message_id=new.message_id and run_id=new.run_id and kind='question' and state in ('open','sending');
 return null;
end $$;
revoke all on function public.close_ended_channel_questions() from public,anon,authenticated,service_role;
create trigger channel_runs_close_questions after update of outcome on public.channel_runs for each row
 when (old.outcome is null and new.outcome is not null) execute function public.close_ended_channel_questions();

-- The one claim of a channel question, by any Member of the channel who may write. A pick sends the choice's index and
-- keeps the Engine's own text of it. The main Agent's question is answered by the Member it was addressed to alone, and
-- nobody else. The same answer key again is the same claim; any other claim of an answered card is taken, and of one the
-- Engine stopped waiting for, closed.
create function public.answer_channel_question(c uuid, channel uuid, card bigint, choice int, answer text, answer_key uuid) returns text
language plpgsql security definer set search_path='' as $$
declare asked public.reply_cards; m public.channel_messages; said text;
begin
 if not public.conversation_can_write(c) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 if answer_key is null then raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
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
 if choice is not null then
  if (asked.content->>'multiple')::boolean or choice<0 or choice>=jsonb_array_length(asked.content->'choices') then
   raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
  said:=asked.content->'choices'->>choice;
 else
  said:=answer;
 end if;
 if said is null or btrim(said,E' \t\r\n')='' or length(said)>20000 then
  raise exception 'questionAnswerInvalid' using errcode='22023'; end if;
 update public.reply_cards set state='sending',content=asked.content||jsonb_build_object('answer',said),answered_by=auth.uid(),
  answered_at=now(),answer_key=answer_channel_question.answer_key where id=asked.id;
 return 'claimed';
end $$;
revoke all on function public.answer_channel_question(uuid,uuid,bigint,int,text,uuid) from public,anon,service_role;
grant execute on function public.answer_channel_question(uuid,uuid,bigint,int,text,uuid) to authenticated;

-- What became of a delivered answer: answered (the Engine took it) or closed (it no longer waited). Only the first
-- verdict counts, and an answered one wins over a card its Run's end closed with the answer kept, as a Conversation's
-- does. It is logged once, as the Member who answered, and read by the channel's members.
create function public.settle_channel_question(card bigint, verdict text) returns text
language plpgsql security definer set search_path='' as $$
declare asked public.reply_cards; called public.channel_runs;
begin
 if verdict is null or verdict not in ('answered','closed') then raise exception 'questionVerdictInvalid' using errcode='22023'; end if;
 select * into asked from public.reply_cards where id=card and kind='question' and channel_message_id is not null for update;
 if not found then return null; end if;
 if not (asked.state='sending' or verdict='answered' and asked.state='closed' and asked.content ? 'answer') then return asked.state; end if;
 update public.reply_cards set state=verdict where id=asked.id;
 if verdict='answered' then
  select * into called from public.channel_runs
   where message_id=asked.channel_message_id and ordinal=coalesce(asked.channel_ordinal,1);
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
   values(asked.company_id,asked.answered_by,'person',(select name from public.people where id=asked.answered_by),'agent',called.agent_id,
    'agent_question_answered',
    jsonb_build_object('question',jsonb_build_object('text',asked.content->'question','answer',asked.content->'answer'),
     'private',true,'teller',asked.answered_by),
    'reply_card_answers',asked.id,asked.answered_at)
   on conflict (source,source_id) do nothing;
 end if;
 return verdict;
end $$;
revoke all on function public.settle_channel_question(bigint,text) from public,anon,authenticated;
grant execute on function public.settle_channel_question(bigint,text) to service_role;

-- The one "Done it" on a channel's handed step, by any Member of the channel who may write: it records who and when and
-- logs it once, and the first press asks the Agent that handed it over to pick up, as a Run of that channel (#140). A
-- later press, from any tab or by anyone, answers that first record and changes nothing. gtmworks does not do the step
-- and checks nothing outside: "Done it" is the Member's word.
create function public.mark_channel_hand_done(c uuid, channel uuid, card bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare handed public.reply_cards; m public.channel_messages; called public.channel_runs; writer text; body text; told bigint;
begin
 if not public.conversation_can_write(c) then raise exception 'channelNotAllowed' using errcode='42501'; end if;
 select * into handed from public.reply_cards r where r.id=card and r.kind='hand' and r.channel_message_id is not null for update;
 if not found then raise exception 'channelNotFound' using errcode='P0002'; end if;
 select * into m from public.channel_messages where id=handed.channel_message_id;
 if m.id is null or m.company_id<>c or m.channel_id<>channel or not public.in_channel(channel) then
  raise exception 'channelNotFound' using errcode='P0002'; end if;
 if handed.state='done' then return jsonb_build_object('state','done','at',handed.done_at,'first',false); end if;
 update public.reply_cards set state='done',done_by=auth.uid(),done_at=now() where id=handed.id returning * into handed;
 select name into writer from public.people where id=auth.uid();
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(handed.company_id,auth.uid(),'person',writer,'agent',
   (select r.agent_id from public.channel_runs r where r.message_id=handed.channel_message_id and r.ordinal=coalesce(handed.channel_ordinal,1)),
   'agent_hand_done',
   jsonb_build_object('hand',jsonb_build_object('title',handed.title),'private',true,'teller',auth.uid()),
   'reply_card_answers',handed.id,handed.done_at)
  on conflict (source,source_id) do nothing;
 select * into called from public.channel_runs
  where message_id=handed.channel_message_id and ordinal=coalesce(handed.channel_ordinal,1);
 -- The pickup Run starts only for an Agent the presser may call in this channel (#354): one hidden from them, or since
 -- removed from the channel, gets none. The step is still recorded as done.
 if called.agent_id is not null and public.channel_agent(m.channel_id,auth.uid(),called.agent_id) then
  body:=public.hand_turn_message(writer,handed.title,handed.content->>'app',handed.done_at);
  insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key,hand_card)
   values(m.company_id,m.channel_id,'person',auth.uid(),coalesce(writer,''),body,gen_random_uuid(),handed.id) returning id into told;
  insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,instructions,rules)
   values(told,1,m.company_id,m.channel_id,called.agent_id,called.agent_name,md5(m.channel_id::text||':'||called.agent_id::text)::uuid,
    split_part(coalesce(writer,''),' ',1)||': '||body,null,public.agent_rules_in_force(called.agent_id));
 end if;
 return jsonb_build_object('state','done','at',handed.done_at,'first',true,'message',told);
end $$;
revoke all on function public.mark_channel_hand_done(uuid,uuid,bigint) from public,anon,service_role;
grant execute on function public.mark_channel_hand_done(uuid,uuid,bigint) to authenticated;

-- #152's pin_channel_run, with the handed step after the review: a channel Run is offered hand_over too, so an Agent may
-- hand a step no Agent does to the team.
create or replace function public.pin_channel_run(message bigint, specs jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs; m public.channel_messages; offered text[];
begin
 select * into r from public.channel_runs where message_id=message and outcome is null order by ordinal limit 1 for update;
 if r.message_id is null or r.outcome is not null then return null; end if;
 if r.tools is null then
  select * into m from public.channel_messages where id=message;
  if m.id is null or m.author<>'person' then return null; end if;
  if public.channel_can_show_cards(r.channel_id,m.person_id,r.agent_id) then
   offered:=array(select t from unnest(array['show_draft','show_review','hand_over']) t where jsonb_typeof(specs->t)='string');
   update public.channel_runs set tools=case when cardinality(offered)>0 then
     '['||(select string_agg(specs->>t,',' order by o) from unnest(offered) with ordinality u(t,o))||']' end
    where message_id=message and ordinal=r.ordinal returning * into r;
  end if;
 end if;
 return jsonb_build_object('tools',r.tools);
end $$;
revoke all on function public.pin_channel_run(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.pin_channel_run(bigint,jsonb) to service_role;

-- #152's channel_show_card, and a handed step is kept open for the team's "Done it"; every other kind is shown. A handed
-- step writes no log row here: its one row is the press (mark_channel_hand_done).
create or replace function public.channel_show_card(message bigint, run text, call text, kind text, title text, content jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs; m public.channel_messages; kept public.reply_cards; opened text:=case when kind='hand' then 'open' else 'shown' end;
begin
 select * into kept from public.reply_cards c where c.channel_message_id=message and c.run_id=run and c.call_id=call;
 if found then return jsonb_build_object('state','shown','card',kept.id); end if;
 select * into r from public.channel_runs where message_id=message and run_id=run;
 select * into m from public.channel_messages where id=message;
 if r.message_id is null or m.id is null or m.author<>'person' or r.run_id is distinct from run
  or kind not in ('draft','review','hand')
  or not public.channel_can_show_cards(r.channel_id,m.person_id,r.agent_id) then return jsonb_build_object('state','refused'); end if;
 if not (public.reply_card_text(to_jsonb(title),100) and public.reply_card_valid(kind,opened,content)) then
  return jsonb_build_object('state','invalid'); end if;
 insert into public.reply_cards(company_id,channel_message_id,channel_ordinal,run_id,call_id,kind,title,content,state)
  values(r.company_id,message,r.ordinal,run,call,kind,title,content,opened)
  on conflict (channel_message_id,run_id,call_id) do nothing returning * into kept;
 if kept.id is null then
  select * into kept from public.reply_cards c where c.channel_message_id=message and c.run_id=run and c.call_id=call;
 elsif kept.kind<>'hand' then
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
   values(r.company_id,r.agent_id,'agent',(select name from public.hermes_agents where id=r.agent_id),'agent',r.agent_id,'agent_card_shown',
    jsonb_build_object('card',jsonb_build_object('kind',kept.kind,'title',kept.title)||case when kept.kind='review' then
      (select jsonb_build_object('fine',count(*) filter (where i->'fine'='true'::jsonb),'edits',count(*) filter (where i->'fine'='false'::jsonb))
       from jsonb_array_elements(kept.content->'items') i) else '{}'::jsonb end,
     'private',true,'teller',m.person_id),
    'reply_cards',kept.id,kept.created_at)
   on conflict (source,source_id) do nothing;
 end if;
 return jsonb_build_object('state','shown','card',kept.id);
end $$;
revoke all on function public.channel_show_card(bigint,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.channel_show_card(bigint,text,text,text,text,jsonb) to service_role;

-- Whether a channel reply card is one the caller may read (#354): true only for a Member of the card's channel. A caller
-- outside the Company, and a Manager of it outside that channel, are answered false, so the id of a channel card tells
-- them nothing; the log's policy reads a channel card's row by this alone.
create function public.reply_card_in_channel(card bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.reply_cards c
  join public.channel_messages m on m.id=c.channel_message_id
  where c.id=card and c.channel_message_id is not null and public.in_channel(m.channel_id));
$$;
revoke all on function public.reply_card_in_channel(bigint) from public,anon,service_role;
grant execute on function public.reply_card_in_channel(bigint) to authenticated;

-- Whether a reply card belongs to a channel of the caller's Company that they are not in: what the log's general branch
-- needs to leave such a card's row out. It is false for anyone outside the Company, and for every id that is no channel
-- card, so the caller never learns which ids are channel cards from it either.
create function public.reply_card_in_other_channel(card bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.reply_cards c
  join public.channel_messages m on m.id=c.channel_message_id
  join public.channels k on k.id=m.channel_id
  where c.id=card and c.channel_message_id is not null and c.company_id=k.company_id
   and public.is_member(k.company_id) and not public.in_channel(m.channel_id));
$$;
revoke all on function public.reply_card_in_other_channel(bigint) from public,anon,service_role;
grant execute on function public.reply_card_in_other_channel(bigint) to authenticated;

-- The log rows of a channel's answer and its "Done it" are read by the channel's members alone, also where the Agent is
-- hidden from them elsewhere, as a channel card's row is (#148). A Member of the Company outside that channel reads
-- neither, an Owner or a Manager included, so those rows are kept out of the first branch. Every other row keeps the rule
-- it had.
alter policy company_log_read on public.company_log using (
 (public.is_member(company_id) and public.can_see_agent(company_id,agent_id) and public.can_see_agent(company_id,actor_id)
  and not (source='reply_card_answers' and public.reply_card_in_other_channel(company_log.source_id))
  and (details->>'private' is null or actor_id=auth.uid() or details->>'teller'=auth.uid()::text
   or case when details->>'private'='owners' then public.is_company_owner(company_id) else public.can_manage_company(company_id) end))
 or (source in ('reply_cards','reply_card_answers') and public.reply_card_in_channel(company_log.source_id)));

-- #152's waiting_list, and a channel's open question or handed step is one item for every Member of that channel who may
-- write, the main Agent's question for the Member it was addressed to alone. It leaves every list when one of them acts,
-- since the item is the card's open state. A Viewer has none, and someone outside the channel reads neither.
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
  select r.kind, r.id, case r.kind when 'question' then r.content->>'question' else r.title end, ''::text, v.agent_name,
    (select w.id from public.work_cards w where w.company_id=c and w.conversation_id=r.conversation_id), r.conversation_id, r.created_at
   from public.reply_cards r
   join public.conversations v on v.id=r.conversation_id and v.company_id=r.company_id
   where r.company_id=c and r.kind in ('question','hand','permission') and v.person_id=auth.uid() and public.reply_card_waits(r)
  union all
  select 'channel_permission'::text, p.id, p.title, ''::text, r.agent_name, null::bigint, null::uuid, p.created_at
   from public.channel_permissions p
   join public.channel_runs r on r.message_id=p.message_id and r.ordinal=p.ordinal
   where p.company_id=c and p.state='open' and public.channel_permission_waits(p)
  union all
  select 'channel_question'::text, r.id, r.content->>'question', ''::text, cr.agent_name, null::bigint, null::uuid, r.created_at
   from public.reply_cards r
   join public.channel_messages m on m.id=r.channel_message_id
   join public.channel_runs cr on cr.message_id=r.channel_message_id and cr.ordinal=coalesce(r.channel_ordinal,1)
   where r.company_id=c and r.kind='question' and r.state='open' and cr.outcome is null
    and public.conversation_can_write(c) and public.in_channel(m.channel_id)
    and (r.addressed_to is null or r.addressed_to=auth.uid())
  union all
  select 'channel_hand'::text, r.id, r.title, ''::text, cr.agent_name, null::bigint, null::uuid, r.created_at
   from public.reply_cards r
   join public.channel_messages m on m.id=r.channel_message_id
   join public.channel_runs cr on cr.message_id=r.channel_message_id and cr.ordinal=coalesce(r.channel_ordinal,1)
   where r.company_id=c and r.kind='hand' and r.state='open'
    and public.conversation_can_write(c) and public.in_channel(m.channel_id)
  union all
  select 'agent_key'::text, k.id, g.name, ''::text, ''::text, null::bigint, null::uuid, k.created_at
   from public.agent_key_waits k
   join public.hermes_agents g on g.company_id=k.company_id and g.id=k.agent_id
   where k.company_id=c and public.agent_key_waits_shown(c)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;
