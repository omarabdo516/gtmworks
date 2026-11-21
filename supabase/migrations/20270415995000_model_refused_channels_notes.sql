-- #530: a channel Run, a leg of a handover and a Card note's Run whose model call cannot succeed on a retry keep its
-- cause, as a Conversation's Run does since #457: `no_credit`, `key_refused` or `model_missing`; a Card note's Run also
-- keeps `no_model` (#428 gave it to channels and handovers only). A command handover's leg that ends so closes the
-- person's Run with the same cause, which the chat already reads, and the channel and the Card say what to fix instead
-- of that the Agent could not reply. It is a failure like any other everywhere else: every check that a Run or a leg
-- ended reads `outcome is not null`.
--
-- The previous app version runs against this: it sends `failed` and `no_model` as before, and channel_handovers answers
-- it two columns more, which it does not read.
alter table public.channel_runs drop constraint channel_runs_outcome_check;
alter table public.channel_runs add constraint channel_runs_outcome_check
 check (outcome in ('completed','failed','no_model','no_credit','key_refused','model_missing','stopped','lost'));
alter table public.agent_handovers drop constraint agent_handovers_target_outcome;
alter table public.agent_handovers add constraint agent_handovers_target_outcome
 check (target_outcome in ('completed','failed','no_model','no_credit','key_refused','model_missing','stopped','lost'));
alter table public.agent_handovers drop constraint agent_handovers_follow_up_outcome;
alter table public.agent_handovers add constraint agent_handovers_follow_up_outcome
 check (follow_up_outcome in ('completed','failed','no_model','no_credit','key_refused','model_missing','stopped','lost'));
alter table public.note_runs drop constraint note_runs_outcome_check;
alter table public.note_runs add constraint note_runs_outcome_check
 check (outcome in ('completed','failed','no_model','no_credit','key_refused','model_missing','stopped','lost'));

-- Each closer, from its body as it is now (20270415650000, 20270415990000, 20270212000000), unchanged but for the
-- outcomes it takes, so no earlier body comes back. Replacing a function keeps its arguments, security and grants.
do $$
declare f text; def text; was text;
begin
 foreach f in array array['public.close_channel_run(bigint,text,text,text,bigint,bigint)','public.close_handover_target(bigint,text,text,text)',
  'public.close_handover_follow_up(bigint,text,text,text)','public.close_handover_answer(bigint,text,text,text)'] loop
  def:=pg_get_functiondef(f::regprocedure);
  was:='run_outcome not in (''completed'',''failed'',''no_model'',''stopped'',''lost'')';
  if position(was in def)=0 then raise exception '% changed: %',f,def; end if;
  execute replace(def,was,'run_outcome not in (''completed'',''failed'',''no_model'',''no_credit'',''key_refused'',''model_missing'',''stopped'',''lost'')');
 end loop;
 def:=pg_get_functiondef('public.close_note_run(bigint,text,text,text,bigint,bigint)'::regprocedure);
 was:='run_outcome not in (''completed'',''failed'',''stopped'',''lost'')';
 if position(was in def)=0 then raise exception 'close_note_run changed: %',def; end if;
 execute replace(def,was,'run_outcome not in (''completed'',''failed'',''no_model'',''no_credit'',''key_refused'',''model_missing'',''stopped'',''lost'')');
end $$;

-- 20270415650000's channel_handovers, and after its last column the cause a retry cannot fix of the leg that ended a
-- handover with no reply from the asking Agent (`model_end`: no_model, no_credit, key_refused or model_missing) and the
-- name of the Agent whose leg it was (`model_agent`): the asking Agent's follow-up, or the asked Agent's leg when no
-- follow-up ran. The channel draws that cause's line under the handover's row. `no_model` stays for the previous app
-- version. Its return type changes, so it is made again.
drop function public.channel_handovers(uuid);
create function public.channel_handovers(ch uuid)
returns table(id bigint, message bigint, from_agent uuid, from_name text, from_connection uuid, to_agent uuid, to_name text,
 to_connection uuid, goal text, summary text, reply text, state text, target_outcome text, created_at timestamptz, answered_at timestamptz,
 closed_at timestamptz, no_model boolean, model_end text, model_agent text)
language sql stable security definer set search_path='' as $$
 select h.id,h.channel_message_id,h.from_agent,f.name,f.connection_id,h.to_agent,t.name,t.connection_id,h.goal,h.summary,h.reply,
  h.state,h.target_outcome,h.created_at,h.target_closed_at,h.closed_at,
  coalesce(e.ended='no_model',false),e.ended,case when e.ended is not null then case when h.follow_up_outcome is not null then f.name else t.name end end
 from public.agent_handovers h
  join public.channel_messages m on m.id=h.channel_message_id
  join public.hermes_agents f on f.id=h.from_agent and f.company_id=h.company_id
  join public.hermes_agents t on t.id=h.to_agent and t.company_id=h.company_id
  cross join lateral (select case when h.state in ('done','failed') and h.reply is null
   and coalesce(h.follow_up_outcome,h.target_outcome) in ('no_model','no_credit','key_refused','model_missing')
   then coalesce(h.follow_up_outcome,h.target_outcome) end as ended) e
 where m.channel_id=ch and h.company_id=m.company_id and auth.uid() is not null and public.in_channel(ch)
 order by h.id desc;
$$;
revoke all on function public.channel_handovers(uuid) from public,anon,service_role;
grant execute on function public.channel_handovers(uuid) to authenticated;
