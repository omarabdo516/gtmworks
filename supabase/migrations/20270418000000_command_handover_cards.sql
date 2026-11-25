-- #470: a job command's Agent asks and acts in the chat, and Lead learns what it answered.
--
-- A command's handover (#358) answers the person, so the question its Agent asks and the action it waits to be allowed
-- are the person's to answer, drawn in the chat as the cards of the command's own Run (`command:<send key>`, the run of
-- the person's message): track_handover_question and track_handover_permission keep them there through the
-- Conversation's own track_run_question and track_run_permission, and hand back each answer or choice the person gave,
-- for the driver to deliver to the Agent's Engine Run (lib/handovers.mjs). Any other handover answers null: nobody reads
-- that Agent's chat, so its question is answered empty and its request denied, as before. A request offers once and
-- deny, never always: a standing allow is kept on the Conversation's Agent's record, not on the Agent that asked.
-- The command's Agent is no longer told it cannot ask (command_handover_job).
--
-- Lead's next Runs in that chat carry the jobs the chat's commands handed over and what each Agent answered: the brief
-- pinned at each Run's first start (pin_lead_brief) lists the newest five as `commands` (lib/lead-offer.mjs), since a
-- Run's instructions are its own and Lead's session never held the command or its answer.
--
-- The answer to a command Agent's card is logged as answering that Agent (reply_card_asker), not the chat's own.
--
-- The previous app version runs against this: it calls none of the new functions, and reads the brief's keys by name.

create function public.track_handover_question(h bigint, run text, asking jsonb, ended boolean, read_started_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers;
begin
 select * into r from public.agent_handovers x where x.id=h;
 if r.id is null or not r.answers_person or r.conversation_id is null or r.parent_id is not null then return null; end if;
 if r.state<>'target' or r.target_run is distinct from run then return '[]'::jsonb; end if;
 return public.track_run_question(r.conversation_id,r.run_id,asking,ended,read_started_at);
end $$;
revoke all on function public.track_handover_question(bigint,text,jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.track_handover_question(bigint,text,jsonb,boolean,timestamptz) to service_role;

create function public.track_handover_permission(h bigint, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.agent_handovers;
begin
 select * into r from public.agent_handovers x where x.id=h;
 if r.id is null or not r.answers_person or r.conversation_id is null or r.parent_id is not null then return null; end if;
 if r.state<>'target' or r.target_run is distinct from run then return '[]'::jsonb; end if;
 -- No profile is named, so the card never offers always (track_run_permission keeps it only for the chat's own Agent).
 return public.track_run_permission(r.conversation_id,r.run_id,asking,ended,read_started_at,read_ended_at,null);
end $$;
revoke all on function public.track_handover_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.track_handover_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz) to service_role;

-- The job a command hands its Agent, as that Agent's Run is asked it: the person's own message, whole, without the command,
-- and the reply they read, which it may now pause to ask them for (#470). begin_handover (20270415990000) still writes the
-- #358 words, which told the Agent it could not ask; a migration after the levels cutover may not make that function again
-- (tests/staged-migrations.test.mjs), so the driver asks this one for a command's job instead (lib/handovers.mjs). Null for
-- any handover that is no command's.
create function public.command_handover_job(h bigint) returns text
language sql stable security definer set search_path='' as $$
 select 'The person in this chat used a command that is your job.'
  || E'\n\nThe job:\n' || coalesce(nullif((select btrim(regexp_replace(m.body,'^\s*/\S+\s*','')) from public.conversation_messages m
    where m.conversation_id=r.conversation_id and m.run_id=r.run_id and m.author='person' limit 1),''),r.goal)
  || E'\n\nDo the job now, and write the reply they read, in the language they wrote in: what you did, what you found and anything they must know.'
  || ' They read this chat: when you need something only they can tell you, ask them, and an action that needs their yes waits for it here. Write only the reply.'
 from public.agent_handovers r where r.id=h and r.answers_person and r.conversation_id is not null and r.parent_id is null;
$$;
revoke all on function public.command_handover_job(bigint) from public,anon,authenticated;
grant execute on function public.command_handover_job(bigint) to service_role;

-- 20270415100000's pin_lead_brief, with the chat's command jobs and their answers.
create or replace function public.pin_lead_brief(conversation uuid, message_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare held public.conversation_run_reservations; kept public.conversation_run_notes;
begin
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key for update;
 select * into kept from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if kept.conversation_id is null then return null; end if;
 if kept.lead_brief is null and held.conversation_id is not null and held.start_attempts=0 and held.start_unknown_at is null
  and exists(select 1 from public.hermes_agents a where a.id=held.agent_id and a.company_id=held.company_id and a.is_default) then
  update public.conversation_run_notes n set lead_brief=jsonb_build_object(
   'role',(select m.role from public.members m where m.company_id=held.company_id and m.person_id=held.person_id and m.removed_at is null),
   'owner',(select split_part(p.name,' ',1) from public.members m join public.people p on p.id=m.person_id
     where m.company_id=held.company_id and m.role='owner' and m.removed_at is null order by p.name limit 1),
   'agents',coalesce((select jsonb_agg(jsonb_build_object('name',a.name,'job',a.speciality) order by a.name,a.id)
     from public.hermes_agents a
     where a.company_id=held.company_id and a.id<>held.agent_id and public.agent_visible_to(held.company_id,held.person_id,a.id)),'[]'::jsonb),
   'opening',(select m.body from public.conversation_messages m where m.conversation_id=conversation and m.author='agent' and m.run_id='lead-opening'
     and not exists(select 1 from public.conversation_messages p where p.conversation_id=conversation and p.author='person' and public.written_message(p))),
   'hidden',case when public.may_ask_to_open_agents(held.company_id,held.agent_id,held.person_id) then coalesce((
     select jsonb_agg(jsonb_build_object('job',h.job,'asks',split_part(p.name,' ',1),'role',m.role) order by h.job)
      from (select distinct on (lower(btrim(a.speciality))) btrim(a.speciality) job, public.agent_access_named(held.company_id,held.person_id,a.id) named
        from public.agents_hidden_from(held.company_id,held.person_id) a where length(btrim(a.speciality))>0
        order by lower(btrim(a.speciality)),a.id) h
      join public.people p on p.id=h.named
      join public.members m on m.company_id=held.company_id and m.person_id=h.named),'[]'::jsonb) else '[]'::jsonb end,
   -- #470: the jobs this chat's commands handed straight to another Agent, newest five, each with what came of it.
   'commands',coalesce((select jsonb_agg(jsonb_build_object('agent',x.agent,'job',x.job,'outcome',x.outcome,'answer',x.answer) order by x.id)
     from (select h.id,coalesce(t.name,'') agent,
       left(coalesce(nullif((select btrim(regexp_replace(m.body,'^\s*/\S+\s*','')) from public.conversation_messages m
        where m.conversation_id=h.conversation_id and m.run_id=h.run_id and m.author='person' limit 1),''),h.goal),4000) job,
       coalesce(h.target_outcome,'failed') outcome,
       case when h.target_outcome='completed' then left(h.summary,4000) end answer
      from public.agent_handovers h left join public.hermes_agents t on t.id=h.to_agent
      where h.conversation_id=conversation and h.answers_person and h.parent_id is null and h.state in ('done','failed')
      order by h.id desc limit 5) x),'[]'::jsonb))
   where n.conversation_id=conversation and n.send_key=message_key returning * into kept;
 end if;
 return kept.lead_brief;
end $$;


revoke all on function public.pin_lead_brief(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.pin_lead_brief(uuid,uuid) to service_role;

-- Who asked: a card a job command's Agent asked on the command's Run is that Agent's, so its answer is logged as answering
-- that Agent and not the chat's own (the Activity log names it); any other card is the Conversation's Agent's.
create function public.reply_card_asker(card bigint) returns uuid language sql stable security definer set search_path='' as $$
 select coalesce((select h.to_agent from public.agent_handovers h
   where h.conversation_id=r.conversation_id and h.run_id=r.run_id and h.answers_person and h.parent_id is null limit 1),v.agent_id)
 from public.reply_cards r join public.conversations v on v.id=r.conversation_id where r.id=card;
$$;
revoke all on function public.reply_card_asker(bigint) from public,anon,authenticated,service_role;

-- 20270128000000's log_chat_event, naming the Agent the event is about when it is not the Conversation's own.
drop function public.log_chat_event(uuid,uuid,text,text,text,jsonb,uuid,text,bigint,timestamptz);
create function public.log_chat_event(conversation uuid, actor uuid, actor_kind text, actor_name text, action text, details jsonb, teller uuid, origin text, origin_id bigint, at timestamptz, agent uuid default null) returns void
language plpgsql set search_path='' as $$
declare talk public.conversations; tied bigint;
begin
 select * into talk from public.conversations where id=conversation;
 select w.id into tied from public.work_cards w where w.company_id=talk.company_id and w.conversation_id=conversation;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
  values(talk.company_id,actor,actor_kind,actor_name,case when tied is null then 'agent' else 'card' end,tied,coalesce(agent,talk.agent_id),action,
   case when tied is null then details||jsonb_build_object('private',true,'teller',teller) else details end,origin,origin_id,at)
  on conflict (source,source_id) do nothing;
end $$;
revoke all on function public.log_chat_event(uuid,uuid,text,text,text,jsonb,uuid,text,bigint,timestamptz,uuid) from public,anon,authenticated,service_role;

-- 20270128000000's settle_question and 20270129000000's settle_permission, logging the answer as given to the Agent that asked.
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
   asked.answered_by,'reply_card_answers',asked.id,asked.answered_at,public.reply_card_asker(asked.id));
 end if;
 return verdict;
end $$;

create or replace function public.settle_permission(card bigint, verdict text) returns text
language plpgsql security definer set search_path='' as $$
declare asked public.reply_cards;
begin
 if verdict is null or verdict not in ('decided','closed') then raise exception 'permissionVerdictInvalid' using errcode='22023'; end if;
 select * into asked from public.reply_cards where id=card and kind='permission' for update;
 if not found then return null; end if;
 if not (asked.state='sending' or verdict='decided' and asked.state='closed' and asked.content ? 'choice') then return asked.state; end if;
 update public.reply_cards set state=verdict where id=asked.id;
 if verdict='decided' then
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
   values(asked.company_id,asked.decided_by,'person',(select name from public.people where id=asked.decided_by),'agent',
    public.reply_card_asker(asked.id),'agent_permission_decided',
    jsonb_build_object('permission',jsonb_build_object('text',case when btrim(asked.content->>'description',E' \t\r\n')<>'' then asked.content->'description' else asked.content->'command' end,
     'choice',asked.content->'choice'),'private',true,'teller',asked.decided_by),
    'reply_card_answers',asked.id,asked.decided_at)
   on conflict (source,source_id) do nothing;
 end if;
 return verdict;
end $$;

revoke all on function public.settle_permission(bigint,text) from public,anon,authenticated;
grant execute on function public.settle_permission(bigint,text) to service_role;
