-- #19: an Agent proposes a change to its own settings, or Lead to another Agent's (decision 2026-11-16, ADR 0016: the
-- profile is the Agent, so a proposal names a real setting of that Agent's Engine profile). The call is kept as one row
-- with what would change, the reason and its state, and nothing changes on the Engine until an active Owner approves it
-- from "Waiting on you": the app claims it first (claim_agent_change, state 'applying', so no other answer can land while
-- the Engine is written), writes it through #125's writers to that Agent's own profile, reads it back, and only then
-- marks it approved (lib/agent-changes.mjs). A refusal writes nothing. A proposal for something that is not on
-- the list is kept as refused at once and waits on nobody.
--
-- What can be proposed, by `change`:
--  model         the profile's model, "provider/model" (PUT /api/profiles/<name>/model, profiles.py 1056-1068);
--  instructions  the core instructions, the profile's SOUL.md outside the team's rules section (profiles.py 1020-1039, #176);
--  toolset       a toolset the Owner switches per Agent: today `delegation` alone (#29, ADR 0020). Every other toolset of
--                the Company's Agent level is already on, and one above it is never proposed (refused);
--  setting       one of #125's listed settings (lib/engine-settings.mjs, kept equal by tests/agent-changes.test.mjs).
-- An app is asked for with ask_for_app (#203), whose card already waits on the Owner's own sign-in: it is not a change
-- the Owner can approve without signing in, so it is not a proposal.
--
-- Nothing existing is rewritten. The previous app version runs against this: it is never offered propose_change (its
-- tool texts have none, and pin_run offers only what the app gives), and it draws a waiting agent_change row as a plain
-- item of "Waiting on you".

create function public.agent_change_listed(change text, setting text) returns boolean language sql immutable set search_path='' as $$
 select case change
  when 'model' then setting is null
  when 'instructions' then setting is null
  when 'toolset' then setting='delegation'
  when 'setting' then setting in ('delegation.model','delegation.provider','delegation.max_concurrent_children','delegation.reasoning_effort',
   'delegation.max_spawn_depth','memory.memory_enabled','memory.memory_char_limit','memory.write_approval','skills.write_approval',
   'display.personality','timezone','agent.reasoning_effort','tts.speed','stt.language')
  else false end;
$$;
revoke all on function public.agent_change_listed(text,text) from public,anon,authenticated,service_role;

-- The value a listed change may carry: a model as provider/model, instructions as the Engine's floor allows, a toolset
-- switched on or off, a setting as one plain value that is never a credential. Its type and limits for that setting are
-- the writer's to check when it is applied, as for the Owner's own save.
create function public.agent_change_value_valid(change text, value jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(case change
  when 'model' then jsonb_typeof(value)='string' and value#>>'{}' ~ '^[a-z0-9][a-z0-9._-]{0,63}/[^\s/][^\s]{0,199}$'
  when 'instructions' then jsonb_typeof(value)='string' and length(value#>>'{}') between 1 and 20000
  when 'toolset' then jsonb_typeof(value)='boolean'
  when 'setting' then jsonb_typeof(value) in ('string','number','boolean') and length(value#>>'{}')<=500 and not public.secret_like(value#>>'{}')
  else false end,false);
$$;
revoke all on function public.agent_change_value_valid(text,jsonb) from public,anon,authenticated,service_role;

-- `agent_id` is the Agent whose profile would change; `proposed_by` the Agent that proposed it (the same, or Lead).
-- `asked_by` is the Conversation's person, who reads the card in that Conversation. `answered_by` is the Owner who
-- approved or declined; a refused row has none, as nobody refused it.
create table public.agent_change_proposals (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 conversation_id uuid not null,
 run_id text not null,
 call_id text not null,
 agent_id uuid not null references public.hermes_agents(id) on delete cascade,
 proposed_by uuid not null references public.hermes_agents(id) on delete cascade,
 asked_by uuid not null references public.people(id),
 change text not null constraint agent_change_proposals_change check (change in ('model','instructions','toolset','setting')),
 setting text constraint agent_change_proposals_setting check (setting is null or setting ~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$'),
 value jsonb not null,
 reason text not null constraint agent_change_proposals_reason check (length(btrim(reason)) between 1 and 500),
 state text not null default 'waiting' constraint agent_change_proposals_state check (state in ('waiting','applying','approved','declined','refused')),
 answered_by uuid references public.people(id),
 answered_at timestamptz,
 -- The Owner whose approval is being written to the Engine, and since when (state 'applying').
 claimed_by uuid references public.people(id),
 claimed_at timestamptz,
 -- A decline of an approval whose Engine write was never confirmed: the change may be in the Agent's settings.
 maybe_applied boolean not null default false,
 answer text constraint agent_change_proposals_answer_text check (answer is null or length(btrim(answer)) between 1 and 1000),
 created_at timestamptz not null default now(),
 unique (conversation_id,run_id,call_id),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id),
 -- Only a listed change with a valid value ever waits or is approved; anything else is kept as refused, answered by nobody.
 constraint agent_change_proposals_listed check (state='refused' or (public.agent_change_listed(change,setting) and public.agent_change_value_valid(change,value))),
 constraint agent_change_proposals_answered check ((state in ('approved','declined'))=(answered_by is not null) and (answered_by is null)=(answered_at is null)
  and (answer is null or state='declined')),
 constraint agent_change_proposals_claimed check ((claimed_by is null)=(claimed_at is null) and (state<>'applying' or claimed_at is not null))
);
create index agent_change_proposals_waiting on public.agent_change_proposals(company_id,created_at) where state in ('waiting','applying');

-- The Company's Owners read every proposal; the person whose Conversation it came from reads it there, while they still
-- see the Agent it would change.
alter table public.agent_change_proposals enable row level security;
create policy agent_change_proposals_read on public.agent_change_proposals for select to authenticated
 using (public.is_member(company_id) and (public.is_company_owner(company_id)
  or (asked_by=auth.uid() and public.can_see_agent(company_id,agent_id) and public.can_see_agent(company_id,proposed_by))));
revoke all on public.agent_change_proposals from anon,authenticated,service_role;
grant select on public.agent_change_proposals to authenticated;

-- Any Agent the person may work with proposes for itself; Lead may name another Agent the person sees.
create function public.may_propose_agent_change(c uuid, agent uuid, person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.may_show_reply_cards(c,agent,person);
$$;
revoke all on function public.may_propose_agent_change(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.run_tools(c uuid, agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[
  case when public.may_use_lead_tools(c,agent,person) then 'create_agent' when public.may_ask_lead_for_agents(c,agent,person) then 'request_agent' end,
  case when public.may_hand_to_agent(c,agent,person) then 'hand_to_agent' end,
  case when public.may_tell_agent_rules(c,agent,person) then 'save_rule' when public.may_suggest_agent_rules(c,agent,person) then 'suggest_team_rule' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_draft' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_review' end,
  case when public.may_show_reply_cards(c,agent,person) then 'hand_over' end,
  case when public.may_show_reply_cards(c,agent,person) then 'ask_for_app' end,
  case when public.may_propose_agent_change(c,agent,person) then 'propose_change' end],null);
$$;

-- Carried out by whoever closes the run (the worker, or a reader): the same run and call again answer the proposal they
-- kept. A call that cannot be carried out answers as a value, never an error, so its run still closes. `agent_name`
-- null (or the Conversation's own Agent) proposes for that Agent; another name is Lead's alone, and only an Agent of the
-- Company the person sees. The log row (private to the Owners and the person) is written for a waiting proposal only.
create function public.agent_propose_change(conversation uuid, run text, call text, agent_name text, change text, setting text, value jsonb, reason text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare talk public.conversations; target public.hermes_agents; kept public.agent_change_proposals; said text:=btrim(coalesce(reason,''),E' \t\r\n');
 listed boolean;
begin
 select * into kept from public.agent_change_proposals p where p.conversation_id=conversation and p.run_id=run and p.call_id=call;
 if found then return jsonb_build_object('state',case when kept.state='refused' then 'refused' else 'proposed' end,'proposal',kept.id); end if;
 select * into talk from public.conversations where id=conversation;
 if not found or talk.agent_id is null
  or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not public.may_propose_agent_change(talk.company_id,talk.agent_id,talk.person_id) then return jsonb_build_object('state','refused'); end if;
 if length(said) not between 1 and 500 or change not in ('model','instructions','toolset','setting') or value is null
  or (setting is not null and setting !~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$') then return jsonb_build_object('state','invalid'); end if;
 if nullif(btrim(coalesce(agent_name,'')),'') is null then
  select * into target from public.hermes_agents a where a.id=talk.agent_id;
 else
  select * into target from public.hermes_agents a
   where a.company_id=talk.company_id and lower(btrim(a.name))=lower(btrim(agent_name)) and public.agent_visible_to(talk.company_id,talk.person_id,a.id)
   order by (a.id=talk.agent_id) desc, a.id limit 1;
  if not found or (target.id<>talk.agent_id and not public.is_company_lead(talk.company_id,talk.agent_id)) then return jsonb_build_object('state','ignored'); end if;
 end if;
 listed:=public.agent_change_listed(change,setting);
 -- A listed change whose value does not read keeps nothing, so the Agent can propose it again correctly.
 if listed and not public.agent_change_value_valid(change,value) then return jsonb_build_object('state','invalid'); end if;
 insert into public.agent_change_proposals(company_id,conversation_id,run_id,call_id,agent_id,proposed_by,asked_by,change,setting,value,reason,state)
  values(talk.company_id,conversation,run,call,target.id,talk.agent_id,talk.person_id,change,setting,value,said,case when listed then 'waiting' else 'refused' end)
  on conflict (conversation_id,run_id,call_id) do nothing returning * into kept;
 if kept.id is null then
  select * into kept from public.agent_change_proposals p where p.conversation_id=conversation and p.run_id=run and p.call_id=call;
 elsif kept.state='waiting' then
  -- The Agent that proposed is the row's actor, as for a card it shows (log_agent_event names people only).
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
   values(talk.company_id,talk.agent_id,'agent',(select a.name from public.hermes_agents a where a.id=talk.agent_id),'agent',target.id,'agent_change_proposed',
    jsonb_strip_nulls(jsonb_build_object('agent_name',target.name,'setting',coalesce(setting,change),'new',case when change='instructions' then null else value end,
     'reason',said,'private','owners','teller',talk.person_id)),
    'hermes_agent_audit',nextval('public.agent_log_ids'),now());
 end if;
 return jsonb_build_object('state',case when kept.state='refused' then 'refused' else 'proposed' end,'proposal',kept.id);
end $$;
revoke all on function public.agent_propose_change(uuid,text,text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.agent_propose_change(uuid,text,text,text,text,text,jsonb,text) to service_role;

-- Approving is three steps, so no other answer lands while the Engine is written. claim_agent_change takes a waiting
-- proposal for this Owner (state 'applying') and returns what to write; one already claimed is answered busy while its
-- claim is under two minutes old, and taken over after that (its write may have been lost). The app then writes the
-- Engine and, once the change is read back, answer_agent_change marks it approved. A claim whose write was refused before
-- anything reached the Engine is given back (release_agent_change); one whose outcome is unknown stays applying, so the
-- Owner approves it again, which writes nothing new, and a decline cannot claim that nothing changed meanwhile. An Owner
-- calling these functions directly can mark a claimed proposal approved without the write; it is their own record.
create function public.claim_agent_change(c uuid, proposal bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare asked public.agent_change_proposals;
begin
 if not public.is_company_owner(c) then raise exception 'agentChangeNotAllowed' using errcode='42501'; end if;
 select * into asked from public.agent_change_proposals p where p.id=proposal and p.company_id=c for update;
 if not found then raise exception 'agentChangeNotFound' using errcode='P0002'; end if;
 if asked.state in ('approved','declined','refused') then return jsonb_build_object('state',asked.state); end if;
 -- A claim taken again (its own Owner's, or a stale one) may follow a write that reached the Engine unconfirmed: the app
 -- then never gives it back.
 if asked.state='applying' and asked.claimed_by is distinct from auth.uid() and asked.claimed_at>now()-interval '2 minutes' then
  return jsonb_build_object('state','busy');
 end if;
 update public.agent_change_proposals set state='applying',claimed_by=auth.uid(),claimed_at=now() where id=asked.id;
 return jsonb_build_object('state','claimed','retry',asked.state='applying','agent',asked.agent_id,'change',asked.change,'setting',asked.setting,'value',asked.value);
end $$;
revoke all on function public.claim_agent_change(uuid,bigint) from public,anon,service_role;
grant execute on function public.claim_agent_change(uuid,bigint) to authenticated;

create function public.release_agent_change(c uuid, proposal bigint) returns void
language sql security definer set search_path='' as $$
 update public.agent_change_proposals set state='waiting',claimed_by=null,claimed_at=null
  where id=proposal and company_id=c and state='applying' and claimed_by=auth.uid() and public.is_company_owner(c);
$$;
revoke all on function public.release_agent_change(uuid,bigint) from public,anon,service_role;
grant execute on function public.release_agent_change(uuid,bigint) to authenticated;

-- An Owner's answer: an approval marks a proposal this Owner claimed (its change now held by the Engine); a decline needs
-- a waiting one, writes nothing to the Engine, and needs the Owner's reason unless the Company is one person working
-- alone. The same answer again answers the same and logs nothing more; the other answer, an answer to a refused
-- proposal, or a decline while an approval is being written, is refused.
create function public.answer_agent_change(c uuid, proposal bigint, approve boolean, reason text default null) returns text
language plpgsql security definer set search_path='' as $$
declare asked public.agent_change_proposals; wanted text:=case when approve then 'approved' when not approve then 'declined' end;
 said text:=nullif(btrim(coalesce(reason,''),E' \t\r\n'),'');
begin
 if wanted is null then raise exception 'agentChangeAnswerMissing' using errcode='22023'; end if;
 if not public.is_company_owner(c) then raise exception 'agentChangeNotAllowed' using errcode='42501'; end if;
 select * into asked from public.agent_change_proposals p where p.id=proposal and p.company_id=c for update;
 if not found then raise exception 'agentChangeNotFound' using errcode='P0002'; end if;
 if asked.state=wanted then return wanted; end if;
 if approve and not (asked.state='applying' and asked.claimed_by=auth.uid()) then
  raise exception '%',case asked.state when 'waiting' then 'agentChangeNotClaimed' when 'applying' then 'agentChangeBusy' else 'agentChangeAnswered' end using errcode='22023';
 end if;
 -- A decline waits for an approval being written; one whose claim is stale (two minutes, its write never confirmed) may be
 -- declined, and says the earlier approval may have reached the Engine, so the proposal never waits for good.
 if not approve and asked.state='applying' and asked.claimed_at>now()-interval '2 minutes' then raise exception 'agentChangeApplying' using errcode='22023'; end if;
 if not approve and asked.state not in ('waiting','applying') then raise exception 'agentChangeAnswered' using errcode='22023'; end if;
 if said is not null and length(said)>1000 then raise exception 'agentChangeReasonLong' using errcode='22023'; end if;
 if not approve and said is null and not exists(select 1 from public.companies co where co.id=c and co.work_mode='alone') then
  raise exception 'agentChangeReasonMissing' using errcode='22023';
 end if;
 update public.agent_change_proposals set state=wanted,answered_by=auth.uid(),answered_at=now(),answer=case when approve then null else said end,
  maybe_applied=(not approve and asked.state='applying') where id=asked.id;
 perform public.log_agent_event(c,auth.uid(),null,asked.agent_id,case when approve then 'AGENT_CHANGE_APPROVED' else 'AGENT_CHANGE_DECLINED' end,
  jsonb_build_object('setting',coalesce(asked.setting,asked.change),'new',case when asked.change='instructions' then null else asked.value end,
   'reason',case when approve then null else said end,'asked_by',(select a.name from public.hermes_agents a where a.id=asked.proposed_by),
   'private','owners','teller',asked.asked_by));
 return wanted;
end $$;
revoke all on function public.answer_agent_change(uuid,bigint,boolean,text) from public,anon,service_role;
grant execute on function public.answer_agent_change(uuid,bigint,boolean,text) to authenticated;

-- 20270327000000's list, with each waiting proposal for every Owner: the Agent it would change, what, and who proposed it.
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
  union all
  select 'agent_change'::text, p.id, g.name, p.change, b.name, null::bigint, null::uuid, p.created_at
   from public.agent_change_proposals p
   join public.hermes_agents g on g.company_id=p.company_id and g.id=p.agent_id
   join public.hermes_agents b on b.company_id=p.company_id and b.id=p.proposed_by
   where p.company_id=c and p.state in ('waiting','applying') and public.is_company_owner(c)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;
