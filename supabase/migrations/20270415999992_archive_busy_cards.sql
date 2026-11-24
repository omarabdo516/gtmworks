-- #671 (spec #667, ADR 0026): archiving a Card an Agent works on, or that waits on someone. Before archiving, the board
-- asks what would stop (card_archive_stops) and names each thing in one confirmation, only when something does. Archiving
-- stops the Card's Runs and the work queued behind them through the stops that exist, a note's Run among them, and clears
-- everything that waits on people because of the Card: questions, permission requests, handed steps and mentions leave
-- every Member's list, and an open approval ends with no decision, which is not a rejection. A Run that closes after it
-- writes its end and never asks, moves or restores the Card; nothing starts work on an archived Card, and what would
-- move one leaves it archived. Restoring starts nothing and makes nobody wait again.

-- A note's Run is stopped as a chat's and a channel message's are: Stop keeps its place, and the worker stops the Run in
-- the Engine while it runs (stopped_runs_open), until the note's driver closes it as the Engine ended it.
alter table public.stopped_runs add column note_id bigint references public.note_runs(note_id) on delete cascade;
alter table public.stopped_runs drop constraint stopped_runs_one_place;
alter table public.stopped_runs add constraint stopped_runs_one_place check (num_nonnulls(conversation_id,channel_message_id,note_id)=1);

create or replace function public.stopped_runs_open() returns TABLE(run text, profile text, company uuid)
language sql stable security definer set search_path='' as $$
 select s.run_id, r.profile, s.company_id from public.stopped_runs s
  join public.channel_runs r on r.message_id=s.channel_message_id and r.run_id=s.run_id and r.outcome is null
 union all
 select s.run_id, a.profile, s.company_id from public.stopped_runs s
  join public.conversations c on c.id=s.conversation_id
  join public.hermes_agents a on a.id=c.agent_id and a.company_id=c.company_id
 where not exists(select 1 from public.conversation_run_ends u where u.conversation_id=s.conversation_id and u.run_id=s.run_id)
  and not exists(select 1 from public.conversation_messages m where m.conversation_id=s.conversation_id and m.author='agent' and m.run_id=s.run_id)
  and s.stopped_at > now()-interval '1 day'
 union all
 select s.run_id, r.profile, s.company_id from public.stopped_runs s
  join public.note_runs r on r.note_id=s.note_id and r.run_id=s.run_id and r.outcome is null;
$$;


-- A step handed to a person closes, unanswered, when the Card it waits on is archived: it leaves every list, and restoring
-- the Card makes nobody wait on it again. Its Conversation still shows it, and its person may still mark it done there.

create or replace function public.reply_card_valid(kind text, state text, content jsonb) returns boolean
language sql immutable set search_path='' as $$
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
  when 'hand' then state in ('open','done','closed') and case when jsonb_typeof(content)='object' then
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


-- What stops in one Conversation when it, or the Card it is the chat of, is archived, one line per thing: its Agent
-- working there (its open Run, a turn waiting behind it or a Handover it started) and each question, permission request
-- or handed step it waits on its person for. The one reading behind card_archive_stops and conversation_archive_stops
-- (20270415999994), which decide who may ask; it runs as its caller and nobody calls it directly.
create function public.conversation_work_stops(conversation uuid) returns table(kind text, agent_id uuid, agent_name text)
language sql stable set search_path='' as $$
 select 'run'::text, v.agent_id, v.agent_name from public.conversations v
 where v.id=conversation and (exists(select 1 from public.conversation_open_run(v.id))
  or exists(select 1 from public.conversation_queued_turns q where q.conversation_id=v.id and q.started_at is null and q.failed_at is null)
  or exists(select 1 from public.agent_handovers h where h.conversation_id=v.id and h.state not in ('done','failed')))
 union all
 select distinct r.kind, v.agent_id, v.agent_name from public.conversations v
  join public.reply_cards r on r.conversation_id=v.id and r.company_id=v.company_id and r.kind in ('question','permission','hand') and r.state='open'
 where v.id=conversation
  and (r.kind='hand' or not exists(select 1 from public.conversation_run_ends u where u.conversation_id=r.conversation_id and u.run_id=r.run_id));
$$;
revoke all on function public.conversation_work_stops(uuid) from public,anon,authenticated,service_role;

-- What stops in one team channel when it, or the Card it is the channel of, is archived, one line per thing: each Agent
-- working there (an open Run, or the Agent an open Handover started there went to) and each question, permission
-- request and handed step waiting on people there, with its own words (`title`). The one reading behind
-- card_archive_stops and channel_archive_stops (20270415999995); it runs as its caller and nobody calls it directly.
create function public.channel_work_stops(ch uuid) returns table(kind text, agent_id uuid, agent_name text, title text)
language sql stable set search_path='' as $$
 select distinct 'run'::text, r.agent_id, r.agent_name, ''::text from public.channel_runs r where r.channel_id=ch and r.outcome is null
 union
 select 'run', a.id, a.name, '' from public.agent_handovers h
  join public.channel_messages m on m.id=h.channel_message_id
  join public.hermes_agents a on a.id=h.to_agent and a.company_id=h.company_id
  where m.channel_id=ch and h.state not in ('done','failed')
 union all
 select 'question', cr.agent_id, cr.agent_name, x.content->>'question' from public.reply_cards x
  join public.channel_messages m on m.id=x.channel_message_id
  join public.channel_runs cr on cr.message_id=x.channel_message_id and cr.ordinal=coalesce(x.channel_ordinal,1)
  where m.channel_id=ch and x.kind='question' and x.state='open' and cr.outcome is null
 union all
 select 'permission', cr.agent_id, cr.agent_name, p.title from public.channel_permissions p
  join public.channel_runs cr on cr.message_id=p.message_id and cr.ordinal=coalesce(p.ordinal,1)
  where p.channel_id=ch and p.state='open'
 union all
 select 'hand', cr.agent_id, cr.agent_name, x.title from public.reply_cards x
  join public.channel_messages m on m.id=x.channel_message_id
  join public.channel_runs cr on cr.message_id=x.channel_message_id and cr.ordinal=coalesce(x.channel_ordinal,1)
  where m.channel_id=ch and x.kind='hand' and x.state='open';
$$;
revoke all on function public.channel_work_stops(uuid) from public,anon,authenticated,service_role;

-- What archiving the named Cards would stop, one line per thing, for the confirmation that names each one: what stops in
-- a Card's chat and in its team channel (above), a note's Run on it, and the approval it waits for. Several Cards are
-- asked at once, as a selection is archived at once (#672). A Card with nothing going on answers nothing, so nothing is
-- asked. A Card that is archived already, hidden from the caller or another Company's answers nothing, and an Agent
-- hidden from the caller is not named (the confirmation says "An Agent").
create function public.card_archive_stops(c uuid, cards bigint[]) returns table(card bigint, title text, kind text, agent text, agent_id uuid)
language sql stable security definer set search_path='' as $$
 with chosen as (
  select w.id, w.title, w.company_id, w.conversation_id, w.channel_id, w.stage_id, w.approval_step_id from public.work_cards w
  where w.company_id=c and w.id=any(cards) and w.archived_at is null and auth.uid() is not null and public.is_member(c) and public.can_see_card(c,w.id)),
 found(id,title,kind,agent_id,agent_name) as (
  select w.id, w.title, s.kind, s.agent_id, s.agent_name
  from chosen w join public.conversations v on v.id=w.conversation_id and v.company_id=w.company_id
   cross join lateral public.conversation_work_stops(v.id) s
  union all
  select w.id, w.title, s.kind, s.agent_id, s.agent_name
  from chosen w join public.channels k on k.id=w.channel_id and k.company_id=w.company_id
   cross join lateral public.channel_work_stops(k.id) s
  union all
  select w.id, w.title, 'run', n.agent_id, n.agent_name
  from chosen w join public.note_runs n on n.company_id=w.company_id and n.card_id=w.id and n.outcome is null
  union all
  select w.id, w.title, 'approval', null::uuid, null::text
  from chosen w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id and s.kind='review'
  where w.approval_step_id is not null)
 -- Each Card's lines in its own order: who stops working, then what it asked, then the approval.
 select d.* from (
  select distinct f.id, f.title, f.kind, x.agent_name, x.agent_id
  from found f cross join lateral (select case when seen then f.agent_name end, case when seen then f.agent_id end
   from (select f.agent_id is not null and public.can_see_agent(c,f.agent_id) as seen) v) x(agent_name,agent_id)) d
 order by d.id, array_position(array['run','question','permission','hand','approval'],d.kind), d.agent_name;
$$;
revoke all on function public.card_archive_stops(uuid,bigint[]) from public,anon,service_role;
grant execute on function public.card_archive_stops(uuid,bigint[]) to authenticated;

-- Stops what an Agent does in one Conversation and closes what it asks its person there, inside the database only
-- (archiving its Card, and archiving the Conversation itself, #674). The chat is stopped as its Stop stops it
-- (stop_open_handovers: its open Run and every Handover it started, kept as stopped for the worker to stop in the
-- Engine), and the turns waiting behind it never start; a question, a permission request and a handed step close
-- unanswered. A turn whose start is already on its way is stopped as it lands (record_conversation_turn below, and the
-- Conversation's own restore trigger in 20270415999994). The Conversation itself is left as it is.
create function public.stop_conversation_work(conversation uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.stop_open_handovers(conversation,null);
 with dropped as (
  update public.conversation_queued_turns q set failed_at=now()
   where q.conversation_id=stop_conversation_work.conversation and q.started_at is null and q.failed_at is null
    and not exists(select 1 from public.conversation_run_reservations r where r.conversation_id=q.conversation_id and r.send_key=q.send_key
     and r.abandoned_at is null and (r.start_unknown_at is not null or r.start_attempts>0))
   returning q.send_key)
 delete from public.conversation_run_reservations r using dropped d
  where r.conversation_id=stop_conversation_work.conversation and r.send_key=d.send_key and r.abandoned_at is null;
 update public.reply_cards r set state='closed'
  where r.conversation_id=stop_conversation_work.conversation and r.kind in ('question','permission','hand') and r.state='open';
end $$;
revoke all on function public.stop_conversation_work(uuid) from public,anon,authenticated,service_role;

-- Stops the work in one team channel and closes what waits on people there, inside the database only (archiving its
-- Card, and archiving the channel itself, #675): each message's Runs stop as its Stop stops them (Runs not started yet
-- end stopped; started ones and every open Handover started there are kept for the worker to stop in the Engine); its
-- questions, handed steps and permission requests close. A Run whose start is on its way is stopped as it is named
-- (answer_channel_start, 20270415999995). The channel itself is left as it is.
create function public.stop_channel_work(c uuid, channel uuid) returns void
language plpgsql security definer set search_path='' as $$
declare m bigint;
begin
 for m in select x.id from public.channel_messages x where x.channel_id=stop_channel_work.channel and x.company_id=c
  and (exists(select 1 from public.channel_runs r where r.message_id=x.id and r.outcome is null)
   or exists(select 1 from public.agent_handovers h where h.channel_message_id=x.id and h.state not in ('done','failed')))
  order by x.id loop
  update public.channel_runs r set outcome='stopped', closed_at=now() where r.message_id=m and r.outcome is null and r.run_id is null and r.attempts=0;
  perform public.stop_open_handovers(null,m);
 end loop;
 update public.reply_cards r set state='closed' from public.channel_messages x
  where x.id=r.channel_message_id and x.channel_id=stop_channel_work.channel and r.kind in ('question','hand') and r.state='open';
 update public.channel_permissions p set state='closed' where p.channel_id=stop_channel_work.channel and p.company_id=c and p.state='open';
end $$;
revoke all on function public.stop_channel_work(uuid,uuid) from public,anon,authenticated,service_role;

-- Stops the work on one Card and clears what waits on people because of it, inside archive_cards only (no caller has
-- it): its chat and its team channel stop as above, a note's Run not started yet ends stopped and a running one is
-- stopped by the worker, and every waiting item on the Card is resolved. The Conversation and the channel themselves are
-- left alone: a message written there later is answered as before.
create function public.stop_card_work(c uuid, card bigint) returns void
language plpgsql security definer set search_path='' as $$
declare w public.work_cards;
begin
 select * into w from public.work_cards x where x.company_id=c and x.id=card;
 if w.conversation_id is not null then perform public.stop_conversation_work(w.conversation_id); end if;
 if w.channel_id is not null then perform public.stop_channel_work(c,w.channel_id); end if;
 update public.note_runs n set outcome='stopped', closed_at=now()
  where n.company_id=c and n.card_id=card and n.outcome is null and n.run_id is null and n.attempts=0;
 insert into public.stopped_runs(company_id,note_id,run_id)
  select n.company_id,n.note_id,n.run_id from public.note_runs n where n.company_id=c and n.card_id=card and n.outcome is null and n.run_id is not null
  on conflict do nothing;
 update public.waiting_items i set resolved_at=now() where i.company_id=c and i.card_id=card and i.resolved_at is null;
end $$;
revoke all on function public.stop_card_work(uuid,bigint) from public,anon,authenticated,service_role;

-- Archives the named Cards and answers the ones it archived. The Role is checked once for the call (a Viewer, or anyone
-- outside the Company, is refused); a Card that is not this Company's, is hidden from the caller or is already archived
-- is left out of the answer, so a caller archiving several at once (#672) is told which it could not. Each Card is
-- archived in one step under its row lock: its work stops and what waits on it clears first (stop_card_work), so nothing
-- is left running or asking about an archived Card, and an approval it waits for ends with no decision: no decision row
-- is written, so it is not counted as a rejection. Each Card keeps its column and place, so restoring puts it back where
-- it was, and gains one Activity log row naming the column.
create function public.archive_cards(c uuid, cards bigint[]) returns setof bigint
language plpgsql security definer set search_path='' as $$
declare w public.work_cards; left_column text;
begin
 if auth.uid() is null or not public.work_can_edit(c) then raise exception 'cardArchiveNotAllowed' using errcode='42501'; end if;
 for w in select * from public.work_cards where company_id=c and id=any(cards) and archived_at is null order by id for update loop
  if not public.can_see_card(c,w.id) then continue; end if;
  select s.board_column into left_column from public.work_stages s where s.company_id=c and s.id=w.stage_id;
  perform public.stop_card_work(c,w.id);
  perform set_config('approval.internal','yes',true);
  update public.work_cards set archived_at=now(),archived_by=auth.uid(),approval_step_id=null where company_id=c and id=w.id;
  perform set_config('approval.internal','',true);
  insert into public.work_activity(company_id,card_id,actor_id,action,details)
   values(c,w.id,auth.uid(),'card_archived',jsonb_build_object('column',left_column)
    ||case when w.approval_step_id is not null then jsonb_build_object('approval','ended') else '{}'::jsonb end);
  return next w.id;
 end loop;
end $$;
revoke all on function public.archive_cards(uuid,bigint[]) from public,anon,service_role;
grant execute on function public.archive_cards(uuid,bigint[]) to authenticated;

-- Restores the named archived Cards and answers the ones it restored, with the same checks. Nothing starts: no Run,
-- turn, question, step, mention or approval comes back with the Card. A Card comes back to the column it was in, but a
-- Card whose approval ended when it was archived comes back to the column it was sent for approval from (or the last
-- before review), where it may be sent for approval again: in review with no approval step nobody could decide it.
create function public.restore_cards(c uuid, cards bigint[]) returns setof bigint
language plpgsql security definer set search_path='' as $$
declare w public.work_cards; back_column text; back bigint;
begin
 if auth.uid() is null or not public.work_can_edit(c) then raise exception 'cardRestoreNotAllowed' using errcode='42501'; end if;
 for w in select * from public.work_cards where company_id=c and id=any(cards) and archived_at is not null order by id for update loop
  if not public.can_see_card(c,w.id) then continue; end if;
  back:=null;
  if w.approval_step_id is null and exists(select 1 from public.work_stages s where s.company_id=c and s.id=w.stage_id and s.kind='review') then
   select m.from_stage_id into back from public.work_card_moves m
    join public.work_stages s on s.company_id=m.company_id and s.id=m.from_stage_id and s.kind in ('ideas','before_review')
    where m.company_id=c and m.card_id=w.id and m.to_stage_id=w.stage_id order by m.id desc limit 1;
   if back is null then
    select s.id into back from public.work_stages s where s.company_id=c and s.kind='before_review' order by s.position desc,s.id desc limit 1;
   end if;
  end if;
  perform set_config('approval.internal','yes',true);
  update public.work_cards set archived_at=null,archived_by=null,stage_id=coalesce(back,stage_id),
   review_submitter=case when back is null then review_submitter end,review_entered_at=case when back is null then review_entered_at end,
   next_actor=case when back is null then next_actor end
   where company_id=c and id=w.id;
  perform set_config('approval.internal','',true);
  select s.board_column into back_column from public.work_stages s join public.work_cards x on x.company_id=s.company_id and x.stage_id=s.id where x.company_id=c and x.id=w.id;
  insert into public.work_activity(company_id,card_id,actor_id,action,details)
   values(c,w.id,auth.uid(),'card_restored',jsonb_build_object('column',back_column));
  return next w.id;
 end loop;
end $$;
revoke all on function public.restore_cards(uuid,bigint[]) from public,anon,service_role;
grant execute on function public.restore_cards(uuid,bigint[]) to authenticated;

-- A Run that was stopped asks nothing more (#671): a question, a permission request or a step it would hand over after
-- Stop is not kept, so a Run closing after its Card was archived writes its end and waits on nobody.

create or replace function public.track_run_question(conversation uuid, run text, asking jsonb, ended boolean, read_started_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked text:=asking->>'id'; kept jsonb; handed jsonb; words text:=public.words_of(asking);
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
   or r.state in ('open','sending') and r.run_id<>run and exists(select 1 from public.conversation_run_ends u where u.conversation_id=conversation and u.run_id=r.run_id));
 -- A read that saw the question before another closer ended the Run keeps nothing for it.
 if asked is not null and not ended and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=conversation and u.run_id=run)
  and not exists(select 1 from public.stopped_runs s where s.conversation_id=conversation and s.run_id=run) then
  kept:=jsonb_build_object('question',asking->'text','choices',asking->'choices','multiple',asking->'multiple');
  if length(asked) between 1 and 200 and public.reply_card_valid('question','open',kept) then
   insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at,said_before)
    values(talk.company_id,conversation,run,asked,'question',
     case when length(kept->>'question')<=100 then kept->>'question' else rtrim(left(kept->>'question',99),E' \t\r\n')||'…' end,kept,'open',read_started_at,
     case when not public.conversation_run_said(conversation,run,words) then words end)
    on conflict do nothing;
   -- A read that kept the card before it could read the words leaves them to the next read that can.
   update public.reply_cards r set said_before=words where r.conversation_id=conversation and r.run_id=run and r.kind='question' and r.call_id=asked and r.said_before is null
    and not public.conversation_run_said(conversation,run,words);
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

create or replace function public.track_run_permission(conversation uuid, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz DEFAULT NULL::timestamptz, run_profile text DEFAULT NULL::text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked text:=asking->>'id'; own boolean; kept jsonb; named text; handed jsonb; keeps text[]; words text:=public.words_of(asking);
begin
 -- The lock a Run's end takes (close_ended_run_permissions), so a request is never kept after its Run has ended.
 perform pg_advisory_xact_lock(hashtextextended('permission_run:'||conversation::text||':'||run,0));
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run) then return '[]'::jsonb; end if;
 update public.reply_cards r set state='closed' where r.conversation_id=conversation and r.kind='permission'
  and (r.run_id=run and (ended and r.state in ('open','sending') or r.state='open' and r.call_id is distinct from asked and r.created_at<read_started_at)
   or r.state in ('open','sending') and r.run_id<>run and exists(select 1 from public.conversation_run_ends u where u.conversation_id=conversation and u.run_id=r.run_id));
 if asked is not null and not ended and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=conversation and u.run_id=run)
  and not exists(select 1 from public.stopped_runs s where s.conversation_id=conversation and s.run_id=run) then
  own:=coalesce(run_profile=public.agent_engine_profile(talk.agent_id),false);
  kept:=jsonb_build_object('description',asking->'description','command',asking->'command','choices',
   case when jsonb_typeof(asking->'choices')='array' then coalesce((select jsonb_agg(o order by n) from jsonb_array_elements(asking->'choices') with ordinality x(o,n)
    where own or o<>'"always"'::jsonb),'[]'::jsonb) else asking->'choices' end);
  if length(asked) between 1 and 200 and public.reply_card_valid('permission','open',kept) then
   keeps:=public.permission_allows_of(asking,kept);
   if not public.permission_allows_valid(keeps) then keeps:=null; end if;
   named:=btrim(case when btrim(kept->>'description',E' \t\r\n')<>'' then kept->>'description' else kept->>'command' end,E' \t\r\n');
   insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at,allows,said_before)
    values(talk.company_id,conversation,run,asked,'permission',
     case when length(named)<=100 then named else rtrim(left(named,99),E' \t\r\n')||'…' end,kept,'open',greatest(read_started_at,coalesce(read_ended_at,read_started_at)),keeps,
     case when not public.conversation_run_said(conversation,run,words) then words end)
    on conflict do nothing;
   update public.reply_cards r set said_before=words where r.conversation_id=conversation and r.run_id=run and r.kind='permission' and r.call_id=asked and r.said_before is null
    and not public.conversation_run_said(conversation,run,words);
  end if;
 end if;
 -- Each claimed choice is handed to this closer alone, for 15 seconds (a choice's call to the Engine gives up after 10):
 -- another closer's read meanwhile gets nothing to deliver, so the Engine is asked once; a closer that died or could not
 -- reach the Engine leaves it to the first read after that.
 with given as (
  update public.reply_cards r set delivering_at=now()
   where r.conversation_id=conversation and r.run_id=run and r.kind='permission' and r.state='sending'
    and (r.delivering_at is null or r.delivering_at<now()-interval '15 seconds')
    and not (r.content->>'choice'='always' and public.permission_revoke_held(talk.agent_id))
   returning r.id,r.call_id,r.content)
 select jsonb_agg(jsonb_build_object('card',g.id,'permission',g.call_id,'choice',g.content->'choice') order by g.id) into handed from given g;
 return coalesce(handed,'[]'::jsonb);
end $$;

create or replace function public.agent_show_card(conversation uuid, run text, call text, kind text, title text, content jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; kept public.reply_cards; opened text:=case when kind in ('hand','connect') then 'open' else 'shown' end;
begin
 select * into kept from public.reply_cards r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 if found then return jsonb_build_object('state','shown','card',kept.id); end if;
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not public.may_show_reply_cards(talk.company_id,talk.agent_id,talk.person_id)
  or opened='open' and exists(select 1 from public.stopped_runs s where s.conversation_id=conversation and s.run_id=run) then return jsonb_build_object('state','refused'); end if;
 if not (public.reply_card_text(to_jsonb(title),100) and public.reply_card_valid(kind,opened,content)) then return jsonb_build_object('state','invalid'); end if;
 insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state)
  values(talk.company_id,conversation,run,call,kind,title,content,opened)
  on conflict (conversation_id,run_id,call_id) do nothing returning * into kept;
 if kept.id is null then
  select * into kept from public.reply_cards r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 elsif kept.kind not in ('hand','connect') then
  perform public.log_chat_event(conversation,talk.agent_id,'agent',(select name from public.hermes_agents where id=talk.agent_id),'agent_card_shown',
   jsonb_build_object('card',jsonb_build_object('kind',kept.kind,'title',kept.title)||case when kept.kind='review' then
     (select jsonb_build_object('fine',count(*) filter (where i->'fine'='true'::jsonb),'edits',count(*) filter (where i->'fine'='false'::jsonb))
      from jsonb_array_elements(kept.content->'items') i) else '{}'::jsonb end),
   talk.person_id,'reply_cards',kept.id,kept.created_at);
 end if;
 return jsonb_build_object('state','shown','card',kept.id);
end $$;

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
  or not public.channel_can_show_cards(r.channel_id,m.person_id,r.agent_id)
  or opened='open' and exists(select 1 from public.stopped_runs s where s.channel_message_id=message and s.run_id=run) then return jsonb_build_object('state','refused'); end if;
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
 if asked is not null and not ended and called.outcome is null
  and not exists(select 1 from public.stopped_runs s where s.channel_message_id=message and s.run_id=run) then
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

create or replace function public.track_channel_permission(message bigint, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz DEFAULT NULL::timestamptz, run_profile text DEFAULT NULL::text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare called public.channel_runs; asked text:=asking->>'id'; own boolean; kept jsonb; named text; handed jsonb; keeps text[]; words text:=public.words_of(asking);
begin
 perform pg_advisory_xact_lock(hashtextextended('channel_permission:'||message::text,0));
 select * into called from public.channel_runs where message_id=message and run_id=run;
 if not found then return '[]'::jsonb; end if;
 update public.channel_permissions p set state='closed' where p.message_id=message and p.run_id=run
  and ((ended or called.outcome is not null) and p.state in ('open','sending') or p.state='open' and p.request_id is distinct from asked and p.created_at<read_started_at);
 if asked is not null and not ended and called.outcome is null
  and not exists(select 1 from public.stopped_runs s where s.channel_message_id=message and s.run_id=run) then
  own:=coalesce(run_profile=public.agent_engine_profile(called.agent_id),false);
  kept:=jsonb_build_object('description',asking->'description','command',asking->'command','choices',
   case when jsonb_typeof(asking->'choices')='array' then coalesce((select jsonb_agg(o order by n) from jsonb_array_elements(asking->'choices') with ordinality x(o,n)
    where own or o<>'"always"'::jsonb),'[]'::jsonb) else asking->'choices' end);
  if length(asked) between 1 and 200 and public.reply_card_valid('permission','open',kept) then
   keeps:=public.permission_allows_of(asking,kept);
   if not public.permission_allows_valid(keeps) then keeps:=null; end if;
   named:=btrim(case when btrim(kept->>'description',E' \t\r\n')<>'' then kept->>'description' else kept->>'command' end,E' \t\r\n');
   insert into public.channel_permissions(company_id,channel_id,message_id,run_id,ordinal,request_id,title,content,state,created_at,allows,said_before)
    values(called.company_id,called.channel_id,message,run,called.ordinal,asked,
     case when length(named)<=100 then named else rtrim(left(named,99),E' \t\r\n')||'…' end,kept,'open',greatest(read_started_at,coalesce(read_ended_at,read_started_at)),keeps,
     case when not public.channel_run_said(message,run,words) then words end)
    on conflict do nothing;
   update public.channel_permissions p set said_before=words where p.message_id=message and p.run_id=run and p.request_id=asked and p.said_before is null
    and not public.channel_run_said(message,run,words);
  end if;
 end if;
 -- One closer at a time, as in a Conversation.
 with given as (
  update public.channel_permissions p set delivering_at=now()
   where p.message_id=message and p.run_id=run and p.state='sending'
    and (p.delivering_at is null or p.delivering_at<now()-interval '15 seconds')
    and not (p.content->>'choice'='always' and public.permission_revoke_held(called.agent_id))
   returning p.id,p.request_id,p.content)
 select jsonb_agg(jsonb_build_object('card',g.id,'permission',g.request_id,'choice',g.content->'choice') order by g.id) into handed from given g;
 return coalesce(handed,'[]'::jsonb);
end $$;


-- Nothing starts work on an archived Card (#671): a note on it calls no Agent and asks no Member, a note Run kept for it
-- before ends stopped instead of starting, one whose start was on its way when the Card was archived is stopped as it
-- is named, and a chat is not started from it.

create or replace function public.note_mentions() returns trigger
language plpgsql security definer set search_path='' as $$
declare writer text; card_title text; chosen public.hermes_agents;
begin
 if public.log_actor_kind(new.company_id, new.author_id) <> 'person' then return null; end if;
 if exists(select 1 from public.work_cards w where w.company_id=new.company_id and w.id=new.card_id and w.archived_at is not null) then return null; end if;
 select coalesce(btrim(name),'') into writer from public.people where id=new.author_id;
 select btrim(title) into card_title from public.work_cards where company_id=new.company_id and id=new.card_id;
 insert into public.waiting_items(company_id, person_id, kind, title, body, asked_by, card_id, note_id)
  select new.company_id, m.person_id, 'mention', left(coalesce(nullif(card_title,''), '#'||new.card_id), 300), left(new.body, 4000),
   left(coalesce(writer,''), 120), new.card_id, new.id
  from public.members m join public.people p on p.id=m.person_id
  where m.company_id=new.company_id and m.removed_at is null and m.agent_role is null and m.person_id <> new.author_id
   and not exists(select 1 from public.agents a where a.id=m.person_id) and btrim(p.name) <> ''
   and (public.mention_at(new.body, p.name) > 0 or public.mention_at(new.body, split_part(btrim(p.name),' ',1)) > 0)
  on conflict (note_id, person_id) where note_id is not null do nothing;
 select * into chosen from public.hermes_agents where id=public.channel_mention(new.company_id, new.author_id, new.body);
 if chosen.id is not null then
  insert into public.note_runs(note_id, company_id, card_id, agent_id, agent_name, session, input, instructions, rules)
   values (new.id, new.company_id, new.card_id, chosen.id, chosen.name, md5('note:'||new.card_id||':'||chosen.id::text)::uuid,
           split_part(coalesce(writer,''),' ',1)||': '||new.body, nullif(btrim(chosen.instructions),''), public.agent_rules_in_force(chosen.id))
   on conflict (note_id) do nothing;
 end if;
 return null;
end $$;

create or replace function public.begin_note_start(message bigint) returns TABLE(attempt integer, company uuid, profile text, session uuid, input text, instructions text, rules text[])
language plpgsql security definer set search_path='' as $$
declare r public.note_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into r from public.note_runs where note_id=message for update;
 if r.note_id is null or r.outcome is not null or r.run_id is not null then return; end if;
 if exists(select 1 from public.work_cards w where w.company_id=r.company_id and w.id=r.card_id and w.archived_at is not null) then
  perform public.close_note_run(message,null,'stopped',null,null,null); return; end if;
 if r.attempts = 0 and r.created_at < now()-interval '10 minutes' then perform public.close_note_run(message,null,'failed',null,null,null); return; end if;
 if r.attempts > 0 and r.created_at < now()-interval '1 day' then perform public.close_note_run(message,null,'lost',null,null,null); return; end if;
 if r.attempts = 0 then
  select a.connection_id,a.profile into r.connection_id,r.profile from public.hermes_agents a where a.id=r.agent_id and a.company_id=r.company_id;
  if r.profile is null then perform public.close_note_run(message,null,'failed',null,null,null); return; end if;
 elsif r.profile is null then
  perform public.close_note_run(message,null,'lost',null,null,null); return;
 end if;
 if r.profile ~ '^co-[0-9a-f]{32}$' and (r.profile <> public.company_engine_profile(r.company_id) or not public.company_profile_ready(r.company_id)) then return; end if;
 if public.agent_profile_refusal(r.profile,r.company_id,r.agent_id) is not null then return; end if;
 update public.note_runs set attempts=attempts+1, attempted_at=now(), connection_id=r.connection_id, profile=r.profile
  where note_id=message returning attempts into r.attempts;
 return query select r.attempts, r.company_id, r.profile, r.session, r.input, r.instructions, r.rules;
end $$;

create or replace function public.answer_note_start(message bigint, attempt integer, run text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.note_runs;
begin
 select * into r from public.note_runs where note_id=message for update;
 if r.note_id is null or r.outcome is not null then return false; end if;
 if run is not null then
  if r.run_id is not null then return r.run_id = run; end if;
  update public.note_runs set run_id=run where note_id=message;
  if exists(select 1 from public.work_cards w where w.company_id=r.company_id and w.id=r.card_id and w.archived_at is not null) then
   insert into public.stopped_runs(company_id,note_id,run_id) values(r.company_id,message,run) on conflict do nothing; end if;
  return true;
 end if;
 if attempt = 1 and r.attempts = 1 and r.run_id is null then
  return public.close_note_run(message, null, 'failed', null, null, null);
 end if;
 return false;
end $$;

create or replace function public.start_card_conversation(c uuid, card bigint, conversation uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare w public.work_cards; chosen public.hermes_agents; progress bigint;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 -- Locked first, so two Members starting at once are served one after the other and the second finds the tie.
 select * into w from public.work_cards where company_id=c and id=card for update;
 if not found or w.archived_at is not null or not public.can_see_card(c,card) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
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

create or replace function public.record_conversation_turn(conversation uuid, message_key uuid, run text, started_on uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare turn public.conversation_queued_turns; held public.conversation_run_reservations; chosen public.hermes_agents; writer text; saved bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select * into turn from public.conversation_queued_turns q where q.conversation_id=conversation and q.send_key=message_key;
 if not found or run is null then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if turn.started_at is not null then return false; end if;
 -- Its message was already stored by the direct send's late record: the turn ran; it is started, never failed.
 if exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.send_key=message_key and m.author='person') then
  update public.conversation_queued_turns q set started_at=now() where q.conversation_id=conversation and q.send_key=message_key;
  delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null;
  return false;
 end if;
 select * into chosen from public.hermes_agents a where a.id=turn.agent_id and a.company_id=turn.company_id;
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key;
 if chosen.id is null or held.conversation_id is null or held.abandoned_at is not null or started_on is null or held.connection_id<>started_on or held.profile is distinct from chosen.profile then
  update public.conversation_queued_turns q set failed_at=now() where q.conversation_id=conversation and q.send_key=message_key;
  delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key and r.abandoned_at is null;
  return false;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation_run:'||run,0));
 if exists(select 1 from public.conversation_messages m where m.author='person' and m.run_id=run and m.conversation_id<>conversation) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select name into writer from public.people where id=turn.person_id;
 insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id)
  values(turn.company_id,conversation,'person',turn.person_id,coalesce(writer,''),turn.message,message_key,run) on conflict do nothing returning id into saved;
 delete from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key;
 update public.conversation_queued_turns q set started_at=now() where q.conversation_id=conversation and q.send_key=message_key;
 -- A turn whose start was on its way when the chat's Card was archived is stopped as it is named (#671); one in an
 -- archived Conversation is stopped as its message lands, by the Conversation's restore trigger (20270415999994).
 if saved is not null and exists(select 1 from public.work_cards w where w.company_id=turn.company_id and w.conversation_id=conversation and w.archived_at>=turn.queued_at) then
  insert into public.stopped_runs(company_id,conversation_id,run_id) values(turn.company_id,conversation,run) on conflict do nothing; end if;
 return saved is not null;
end $$;

create or replace function public.add_waiting_item(c uuid, person uuid, item_kind text, item_title text, item_body text DEFAULT ''::text, card bigint DEFAULT NULL::bigint, conversation uuid DEFAULT NULL::uuid, asker text DEFAULT ''::text) returns bigint
language plpgsql security definer set search_path='' as $$
declare result bigint; begin
 if not exists(select 1 from public.members where company_id=c and person_id=person and removed_at is null) then raise exception 'not a member' using errcode='22023'; end if;
 if conversation is not null and not exists(select 1 from public.conversations where id=conversation and company_id=c and person_id=person) then raise exception 'conversation not found' using errcode='P0002'; end if;
 -- An archived Card waits on nobody (#671).
 if card is not null and exists(select 1 from public.work_cards w where w.company_id=c and w.id=card and w.archived_at is not null) then return null; end if;
 insert into public.waiting_items(company_id,person_id,kind,title,body,asked_by,card_id,conversation_id)
  values(c,person,item_kind,btrim(item_title),coalesce(item_body,''),coalesce(asker,''),card,conversation) returning id into result;
 return result;
end $$;


-- What would move an archived Card leaves it archived and where it is (#671): a handover from its chat still hands the
-- work on and logs it on the Card, and gives the Card no new Agent.

create or replace function public.lead_hand_to_agent(conversation uuid, run text, call text, agent_name text, goal text, context text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; target public.hermes_agents; handed public.agent_handovers; asker text; main boolean;
 card bigint; card_agent uuid; stage bigint; first_words text;
begin
 select * into talk from public.conversations where id=conversation for no key update;
 -- A call that cannot be carried out answers as a value, never an error: the run that made it still closes.
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  then return jsonb_build_object('state','refused'); end if;
 if talk.agent_id is null or not public.may_hand_to_agent(talk.company_id,talk.agent_id,talk.person_id)
  then return jsonb_build_object('state','refused'); end if;
 if exists(select 1 from public.stopped_runs s where s.conversation_id=conversation and s.run_id=run)
  then return jsonb_build_object('state','refused'); end if;
 if coalesce(agent_name,'') = '' or coalesce(goal,'') = '' then return jsonb_build_object('state','ignored'); end if;
 select * into target from public.hermes_agents a
  where a.company_id=talk.company_id and a.id<>talk.agent_id and a.profile is not null
   and lower(btrim(a.name))=lower(btrim(agent_name))
  order by a.id limit 1;
 if not found then return jsonb_build_object('state','ignored'); end if;
 insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,context)
  values(talk.company_id,conversation,run,call,talk.agent_id,target.id,btrim(goal),nullif(btrim(coalesce(context,'')),''))
  on conflict (conversation_id,run_id,call_id) do nothing returning * into handed;
 -- The same call again keeps nothing twice: one handover, and so one Card and one log row.
 if handed.id is not null then
  main:=public.is_company_lead(talk.company_id,talk.agent_id);
  select w.id,w.agent_id into card,card_agent from public.work_cards w where w.company_id=talk.company_id and w.conversation_id=conversation;
  if card is null and main then
   -- As #144's Card: the Company's first stage In progress, titled from the person's first message in this chat.
   select s.id into stage from public.work_stages s where s.company_id=talk.company_id and s.board_column='progress' and s.kind='before_review' order by s.position,s.id limit 1;
   if stage is not null then
    select m.body into first_words from public.conversation_messages m where m.conversation_id=conversation and m.author='person' order by m.id limit 1;
    insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id)
     values(talk.company_id,stage,public.chat_card_title(first_words,target.name),target.id,conversation)
     on conflict (conversation_id) where conversation_id is not null do nothing returning id into card;
    -- #354: when two handovers race, the second insert finds the first's Card and takes it, giving it the Agent it
    -- handed the work to as a later handover does, and keeping that Card's stage and title.
    if card is null then
     select w.id into card from public.work_cards w where w.company_id=talk.company_id and w.conversation_id=conversation;
     if card is not null then
      update public.work_cards set agent_id=target.id
       where company_id=talk.company_id and id=card and agent_id is distinct from target.id and archived_at is null; end if;
    end if;
   end if;
  elsif card is not null and main and card_agent is distinct from target.id then
   update public.work_cards set agent_id=target.id where company_id=talk.company_id and id=card and archived_at is null;
  end if;
  if card is not null then
   select a.name into asker from public.hermes_agents a where a.company_id=talk.company_id and a.id=talk.agent_id;
   -- The one who handed the work is the row's actor and the Agent it went to is the Agent the row is about, so a Member
   -- who does not see either one reads no row (company_log_read) and no name in the Card's crew (crew).
   insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
    values(talk.company_id,talk.agent_id,'agent',asker,'card',card,target.id,'agent_handed_to',
     jsonb_build_object('agent_name',asker,'to_name',target.name,'goal',handed.goal),'agent_handovers',handed.id,handed.created_at)
    on conflict (source,source_id) do nothing;
  end if;
 end if;
 return jsonb_build_object('state','created','agent',target.name);
end $$;
