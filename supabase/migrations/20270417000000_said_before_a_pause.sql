-- #647: what an Agent wrote in the message that paused its Run (its answer so far, before a question or a request to
-- allow an action) is the Agent's own words in the chat, drawn above the card that pause keeps. The pinned Engine keeps
-- that message in the session but no text in the run record until the Run completes, and then only what came after the
-- pause; the worker reads it from the session while the Run waits and hands it here with the card (`asking.said`). It is
-- the chat record (ADR 0017), kept once: on the first card of the Run that carries it, never on a second card the same
-- message paused for, and never in the reply that follows. A card kept before its words could be read takes them on a
-- later read. shortcut: the same words are matched by their text, not by the session message they came from; upgrade
-- if one Run writes the same words before two pauses.

alter table public.reply_cards add column said text check (said is null or length(said) between 1 and 200000);
alter table public.channel_permissions add column said text check (said is null or length(said) between 1 and 200000);

-- The words as the worker sends them: text, at most a reply's length, nothing for anything else or only spaces.
create function public.said_before(asking jsonb) returns text language sql immutable set search_path='' as $$
 select case when jsonb_typeof(asking->'said')='string' and btrim(asking->>'said',E' \t\r\n')<>'' and length(asking->>'said')<=200000 then asking->>'said' end;
$$;
revoke all on function public.said_before(jsonb) from public,anon,authenticated;
grant execute on function public.said_before(jsonb) to service_role;

-- Whether a card of this channel Run, question or request, already carries these words.
create function public.channel_run_said(asked bigint, asking_run text, words text) returns boolean language sql stable set search_path='' as $$
 select words is not null and (exists(select 1 from public.reply_cards r where r.channel_message_id=asked and r.run_id=asking_run and r.said=words)
  or exists(select 1 from public.channel_permissions p where p.message_id=asked and p.run_id=asking_run and p.said=words));
$$;
revoke all on function public.channel_run_said(bigint,text,text) from public,anon,authenticated;
grant execute on function public.channel_run_said(bigint,text,text) to service_role;

-- The same for a Conversation's Run, whose questions and requests are both reply cards.
create function public.conversation_run_said(talk uuid, asking_run text, words text) returns boolean language sql stable set search_path='' as $$
 select words is not null and exists(select 1 from public.reply_cards r where r.conversation_id=talk and r.run_id=asking_run and r.said=words);
$$;
revoke all on function public.conversation_run_said(uuid,text,text) from public,anon,authenticated;
grant execute on function public.conversation_run_said(uuid,text,text) to service_role;

-- 20270202000000's track_run_question as it reads now (the run ends' table renamed by 20270212000000), keeping the words.
create or replace function public.track_run_question(conversation uuid, run text, asking jsonb, ended boolean, read_started_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked text:=asking->>'id'; kept jsonb; handed jsonb; words text:=public.said_before(asking);
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
 if asked is not null and not ended and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=conversation and u.run_id=run) then
  kept:=jsonb_build_object('question',asking->'text','choices',asking->'choices','multiple',asking->'multiple');
  if length(asked) between 1 and 200 and public.reply_card_valid('question','open',kept) then
   insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at,said)
    values(talk.company_id,conversation,run,asked,'question',
     case when length(kept->>'question')<=100 then kept->>'question' else rtrim(left(kept->>'question',99),E' \t\r\n')||'…' end,kept,'open',read_started_at,
     case when not public.conversation_run_said(conversation,run,words) then words end)
    on conflict do nothing;
   -- A read that kept the card before it could read the words leaves them to the next read that can.
   update public.reply_cards r set said=words where r.conversation_id=conversation and r.run_id=run and r.kind='question' and r.call_id=asked and r.said is null
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
revoke all on function public.track_run_question(uuid,text,jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.track_run_question(uuid,text,jsonb,boolean,timestamptz) to service_role;

-- 20270415200000's track_run_permission, keeping the words.
create or replace function public.track_run_permission(conversation uuid, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz default null, run_profile text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked text:=asking->>'id'; own boolean; kept jsonb; named text; handed jsonb; keeps text[]; words text:=public.said_before(asking);
begin
 -- The lock a Run's end takes (close_ended_run_permissions), so a request is never kept after its Run has ended.
 perform pg_advisory_xact_lock(hashtextextended('permission_run:'||conversation::text||':'||run,0));
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run) then return '[]'::jsonb; end if;
 update public.reply_cards r set state='closed' where r.conversation_id=conversation and r.kind='permission'
  and (r.run_id=run and (ended and r.state in ('open','sending') or r.state='open' and r.call_id is distinct from asked and r.created_at<read_started_at)
   or r.state in ('open','sending') and r.run_id<>run and exists(select 1 from public.conversation_run_ends u where u.conversation_id=conversation and u.run_id=r.run_id));
 if asked is not null and not ended and not exists(select 1 from public.conversation_run_ends u where u.conversation_id=conversation and u.run_id=run) then
  own:=coalesce(run_profile=public.agent_engine_profile(talk.agent_id),false);
  kept:=jsonb_build_object('description',asking->'description','command',asking->'command','choices',
   case when jsonb_typeof(asking->'choices')='array' then coalesce((select jsonb_agg(o order by n) from jsonb_array_elements(asking->'choices') with ordinality x(o,n)
    where own or o<>'"always"'::jsonb),'[]'::jsonb) else asking->'choices' end);
  if length(asked) between 1 and 200 and public.reply_card_valid('permission','open',kept) then
   keeps:=public.permission_allows_of(asking,kept);
   if not public.permission_allows_valid(keeps) then keeps:=null; end if;
   named:=btrim(case when btrim(kept->>'description',E' \t\r\n')<>'' then kept->>'description' else kept->>'command' end,E' \t\r\n');
   insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at,allows,said)
    values(talk.company_id,conversation,run,asked,'permission',
     case when length(named)<=100 then named else rtrim(left(named,99),E' \t\r\n')||'…' end,kept,'open',greatest(read_started_at,coalesce(read_ended_at,read_started_at)),keeps,
     case when not public.conversation_run_said(conversation,run,words) then words end)
    on conflict do nothing;
   update public.reply_cards r set said=words where r.conversation_id=conversation and r.run_id=run and r.kind='permission' and r.call_id=asked and r.said is null
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
revoke all on function public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text) to service_role;

-- 20270327000000's track_channel_question, keeping the words.
create or replace function public.track_channel_question(message bigint, run text, asking jsonb, ended boolean, read_started_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare called public.channel_runs; m public.channel_messages; asked text:=asking->>'id'; kept jsonb; main boolean; words text:=public.said_before(asking);
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
   insert into public.reply_cards(company_id,channel_message_id,channel_ordinal,run_id,call_id,kind,title,content,state,created_at,addressed_to,said)
    values(called.company_id,message,called.ordinal,run,asked,'question',
     case when length(kept->>'question')<=100 then kept->>'question' else rtrim(left(kept->>'question',99),E' \t\r\n')||'…' end,
     kept,'open',read_started_at,case when main then m.person_id end,
     case when not public.channel_run_said(message,run,words) then words end)
    on conflict do nothing;
   update public.reply_cards r set said=words where r.channel_message_id=message and r.run_id=run and r.kind='question' and r.call_id=asked and r.said is null
    and not public.channel_run_said(message,run,words);
  end if;
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('card',r.id,'question',r.call_id,'answer',r.content->>'answer') order by r.id)
  from public.reply_cards r where r.channel_message_id=message and r.run_id=run and r.kind='question' and r.state='sending'),'[]'::jsonb);
end $$;
revoke all on function public.track_channel_question(bigint,text,jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.track_channel_question(bigint,text,jsonb,boolean,timestamptz) to service_role;

-- 20270415200000's track_channel_permission, keeping the words.
create or replace function public.track_channel_permission(message bigint, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz default null, run_profile text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare called public.channel_runs; asked text:=asking->>'id'; own boolean; kept jsonb; named text; handed jsonb; keeps text[]; words text:=public.said_before(asking);
begin
 perform pg_advisory_xact_lock(hashtextextended('channel_permission:'||message::text,0));
 select * into called from public.channel_runs where message_id=message and run_id=run;
 if not found then return '[]'::jsonb; end if;
 update public.channel_permissions p set state='closed' where p.message_id=message and p.run_id=run
  and ((ended or called.outcome is not null) and p.state in ('open','sending') or p.state='open' and p.request_id is distinct from asked and p.created_at<read_started_at);
 if asked is not null and not ended and called.outcome is null then
  own:=coalesce(run_profile=public.agent_engine_profile(called.agent_id),false);
  kept:=jsonb_build_object('description',asking->'description','command',asking->'command','choices',
   case when jsonb_typeof(asking->'choices')='array' then coalesce((select jsonb_agg(o order by n) from jsonb_array_elements(asking->'choices') with ordinality x(o,n)
    where own or o<>'"always"'::jsonb),'[]'::jsonb) else asking->'choices' end);
  if length(asked) between 1 and 200 and public.reply_card_valid('permission','open',kept) then
   keeps:=public.permission_allows_of(asking,kept);
   if not public.permission_allows_valid(keeps) then keeps:=null; end if;
   named:=btrim(case when btrim(kept->>'description',E' \t\r\n')<>'' then kept->>'description' else kept->>'command' end,E' \t\r\n');
   insert into public.channel_permissions(company_id,channel_id,message_id,run_id,ordinal,request_id,title,content,state,created_at,allows,said)
    values(called.company_id,called.channel_id,message,run,called.ordinal,asked,
     case when length(named)<=100 then named else rtrim(left(named,99),E' \t\r\n')||'…' end,kept,'open',greatest(read_started_at,coalesce(read_ended_at,read_started_at)),keeps,
     case when not public.channel_run_said(message,run,words) then words end)
    on conflict do nothing;
   update public.channel_permissions p set said=words where p.message_id=message and p.run_id=run and p.request_id=asked and p.said is null
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
revoke all on function public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text) to service_role;
