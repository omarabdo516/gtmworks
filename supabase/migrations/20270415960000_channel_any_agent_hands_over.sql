-- #476 (spec #474, decision 0057 point 8, replacing decision 0043 point 6 in a channel): in a channel, any Agent of the
-- channel, not only the Company's main Agent, hands a job to any other Agent of the Company, whether or not it is an Agent
-- of the channel. The person whose message started the Run must still be a member of the channel who may write there (an
-- Owner, a Manager or a Contributor, never a Viewer), as before. An Agent of another Company is never a target, and a
-- name that matches none is ignored, so the Run still closes.
--
-- The tool names its targets: channel_handover_targets lists the Company's other Agents with their job line for the
-- message's Run, as conversation_handover_agents does for a Conversation (#475), and the app makes that list the tool's
-- enum (lib/agent-tools.mjs), pinned with the Run by pin_channel_run as before. An asked Agent outside the channel works
-- in its own session for that channel, as a channel's Agent does, and the asking Agent's follow-up runs in its own.
--
-- What the channel draws is unchanged in shape: channel_handovers names both Agents with their faces, an Agent outside
-- the channel included, and is read by every member of the channel, a Viewer included, and by nobody outside a team
-- channel, its Company's Owner included (in_channel). Only the row's words change, in the app.
--
-- This is one level only: the asked Agent is still told not to hand the job on (the chain is #477), and a job command
-- (#358) is a Conversation's alone.
--
-- The previous app version runs against this: every function keeps its signature and its answer's shape, and the new
-- function is called by this version alone. It still asks channel_handover_agents for names only, which now names the
-- same wider list, and its pinned text for that list is carried out the same way.

-- Who may hand work over in a channel: a member of it who may write there, talking to any Agent of that channel.
create or replace function public.channel_can_hand_over(ch uuid, person uuid, agent uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.channel_agent(ch,person,agent)
  and exists(select 1 from public.channels k join public.members m on m.company_id=k.company_id
   where k.id=ch and m.person_id=person and m.removed_at is null and m.role in ('owner','manager','contributor'));
$$;
revoke all on function public.channel_can_hand_over(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- The Agents a channel message's Run may hand work to, as the tool names them: every other Agent of the Company that can
-- run, in the channel or not, each with its job line, by name. The Run is the one pin_channel_run pins, its message's
-- first open Run (a message may call up to three Agents, #152, one after another). None when that Run may not hand over.
create function public.channel_handover_targets(message bigint) returns table(name text, job text)
language sql stable security definer set search_path='' as $$
 select a.name, a.speciality
 from (select r.* from public.channel_runs r where r.message_id=channel_handover_targets.message and r.outcome is null
   order by r.ordinal limit 1) r
  join public.channel_messages m on m.id=r.message_id and m.author='person'
  join public.hermes_agents a on a.company_id=r.company_id
 where r.agent_id is not null and a.id<>r.agent_id and a.profile is not null and btrim(a.name)<>''
  and public.channel_can_hand_over(m.channel_id,m.person_id,r.agent_id)
 order by a.name, a.id;
$$;
revoke all on function public.channel_handover_targets(bigint) from public,anon,authenticated;
grant execute on function public.channel_handover_targets(bigint) to service_role;

-- 20270329000000's channel_handover_agents, which the previous app version still asks for names: the same list.
create or replace function public.channel_handover_agents(message bigint) returns text[]
language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(t.name order by t.name),'{}') from public.channel_handover_targets(message) t;
$$;
revoke all on function public.channel_handover_agents(bigint) from public,anon,authenticated;
grant execute on function public.channel_handover_agents(bigint) to service_role;

-- 20270329000000's channel_hand_to_agent, with any Agent of the Company but the asking one as the target, in the channel
-- or not. Who may call it is channel_can_hand_over's, above.
do $$
declare def text;
begin
 def:=pg_get_functiondef('public.channel_hand_to_agent(bigint,text,text,text,text,text)'::regprocedure);
 if position(' and public.channel_agent(m.channel_id,m.person_id,a.id)' in def)=0 then raise exception 'channel_hand_to_agent changed: %',def; end if;
 execute replace(def,' and public.channel_agent(m.channel_id,m.person_id,a.id)','');
end $$;

-- 20270415950000's begin_handover, with a channel's handover as a Conversation's became in #475. When the target's Run
-- would start, its sender must still be a member of the channel who may write there, talking to an Agent of it (the
-- rule that kept the call, channel_can_hand_over), and the target no longer needs to be an Agent of the channel. The job
-- names the Agent that asked, not "Lead", since any Agent of the channel may ask.
-- It also reads the asking Agent within the handover's own Company: the earlier filter compared r.company_id with itself,
-- which was always true.
do $$
declare def text; was text; changes text[][] := array[
 ['or (r.conversation_id is null and not public.channel_agent(chan, person, target.id)) then',
  'or (r.conversation_id is null and not public.channel_can_hand_over(chan, person, r.from_agent)) then'],
 ['select * into asking_agent from public.hermes_agents where id=r.from_agent and r.company_id=r.company_id;',
  'select * into asking_agent from public.hermes_agents where id=r.from_agent and company_id=r.company_id;'],
 [E'asking := ''Lead in the team is handing you a job in this channel.''\n    || E''\\n\\nThe job:\\n'' || r.goal\n    || coalesce(E''\\n\\nWhat Lead knows about the job:\\n'' || r.context,'''')\n    || E''\\n\\nDo the job now. Reply with your result for Lead: what you did, what you found and anything Lead must tell the team. Do not ask anyone a question: your reply is what Lead reports, so write the result, not a question.''',
  E'asking := asker || '' in the team is handing you a job in this channel.''\n    || E''\\n\\nThe job:\\n'' || r.goal\n    || coalesce(E''\\n\\nWhat '' || asker || E'' knows about the job:\\n'' || r.context,'''')\n    || E''\\n\\nDo the job now. Reply with your result for '' || asker || '': what you did, what you found and anything '' || asker || '' must tell the team. Do not ask anyone a question: your reply is what '' || asker || '' reports, so write the result, not a question.''']];
begin
 def:=pg_get_functiondef('public.begin_handover(bigint)'::regprocedure);
 for n in 1..array_length(changes,1) loop
  was:=changes[n][1];
  if position(was in def)=0 then raise exception 'begin_handover changed: % not in %',was,def; end if;
  def:=replace(def,was,changes[n][2]);
 end loop;
 execute def;
end $$;
