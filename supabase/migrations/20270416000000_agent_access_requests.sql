-- #167: a Member asks the main Agent for work that belongs to an Agent hidden from them (#15). The main Agent's Run is
-- told the jobs of the Agents hidden from its person, never their names (pin_lead_brief), and is offered one tool,
-- ask_to_open_agent, only while there is one (run_tools). A call names a job; the database finds the Company's Agent
-- with that job that is really hidden from the Conversation's person, and keeps one row: the card under the Agent's
-- turn ("Ask {first name} for it?"), which only that person answers. "Ask" puts the request in "Waiting on you" for
-- everyone who may open that Agent for them (the Owner, and every Manager who sees it, never the asker); "No, never
-- mind" sends nothing. An Owner or a Manager then opens it for them (#15's switch, set_agent_visible) or says no; either
-- answer is drawn as a line in the Member's Conversation, and an opening writes one log row.
--
-- The row names the hidden Agent, so the person who asked never reads it: their Conversation reads its cards through
-- conversation_agent_access, which names the Agent only once it is opened for them.
--
-- Nothing existing is rewritten. The previous app version runs against this: it is never offered ask_to_open_agent
-- (its tool texts have none, and pin_run offers only what the app gives), it ignores the brief's new `hidden` list, and
-- it draws a waiting agent_access row as a plain item of "Waiting on you".

-- `asked_by` is the Conversation's person; `named_to` the person the card names, chosen when the card is made.
-- `pressed_at` is when that person pressed one of the card's two buttons; `answered_by` and `answered_at` the Owner's or
-- Manager's answer to an asked request.
create table public.agent_access_requests (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 conversation_id uuid not null,
 run_id text not null,
 call_id text not null,
 agent_id uuid not null references public.hermes_agents(id) on delete cascade,
 asked_by uuid not null references public.people(id),
 named_to uuid not null references public.people(id),
 state text not null default 'offered' constraint agent_access_requests_state check (state in ('offered','asked','dismissed','opened','declined')),
 pressed_at timestamptz,
 answered_by uuid references public.people(id),
 answered_at timestamptz,
 created_at timestamptz not null default now(),
 unique (conversation_id,run_id,call_id),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id),
 constraint agent_access_requests_pressed check ((state='offered')=(pressed_at is null)),
 constraint agent_access_requests_answered check ((state in ('opened','declined'))=(answered_by is not null) and (answered_by is null)=(answered_at is null))
);
create index agent_access_requests_asked on public.agent_access_requests(company_id,asked_by,agent_id) where state='asked';

-- Who may open an Agent for a Member: an active Owner, or an active Manager who sees that Agent (set_agent_visible lets
-- a Manager change only the Agents they see), never the Member who asks.
create function public.may_open_agent_for(c uuid, answerer uuid, agent uuid, asker uuid) returns boolean language sql stable security definer set search_path='' as $$
 select answerer is distinct from asker and exists(select 1 from public.members m where m.company_id=c and m.person_id=answerer and m.removed_at is null
  and (m.role='owner' or (m.role='manager' and public.agent_visible_to(c,answerer,agent))));
$$;
revoke all on function public.may_open_agent_for(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
-- The same, for the caller only: what the read policy asks.
create function public.can_open_agent_for(c uuid, agent uuid, asker uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_member(c) and public.may_open_agent_for(c,auth.uid(),agent,asker);
$$;
revoke all on function public.can_open_agent_for(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.can_open_agent_for(uuid,uuid,uuid) to authenticated;

-- The person the card names: the Manager who joined first among those who may open the Agent, or the Owner who joined
-- first when there is none. Joining is the member row's first insert in member_audit; a row without one comes last.
create function public.agent_access_named(c uuid, asker uuid, agent uuid) returns uuid language sql stable security definer set search_path='' as $$
 select m.person_id from public.members m left join public.people p on p.id=m.person_id
  where m.company_id=c and public.may_open_agent_for(c,m.person_id,agent,asker)
  order by (m.role='manager') desc,
   (select min(a.created_at) from public.member_audit a where a.company_id=c and a.person_id=m.person_id and a.action='INSERT') nulls last,
   p.name, m.person_id
  limit 1;
$$;
revoke all on function public.agent_access_named(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- The Agents of a Company hidden from one person: never the main Agent, and none for an Owner, who sees every Agent.
create function public.agents_hidden_from(c uuid, person uuid) returns setof public.hermes_agents language sql stable security definer set search_path='' as $$
 select a.* from public.hermes_agents a where a.company_id=c and not a.is_default and not public.agent_visible_to(c,person,a.id);
$$;
revoke all on function public.agents_hidden_from(uuid,uuid) from public,anon,authenticated,service_role;

-- The main Agent may offer to ask for one while its person may ask Lead for Agents (an active Manager or Contributor,
-- talking to the Company's Lead) and an Agent with a job is hidden from them. A Viewer cannot write and is never offered it.
create function public.may_ask_to_open_agents(c uuid, agent uuid, person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.may_ask_lead_for_agents(c,agent,person)
  and exists(select 1 from public.agents_hidden_from(c,person) h where length(btrim(h.speciality))>0);
$$;
revoke all on function public.may_ask_to_open_agents(uuid,uuid,uuid) from public,anon,authenticated,service_role;

alter table public.agent_access_requests enable row level security;
-- Only those who may open the Agent for its Member read the row (the Owners' and Managers' list); the Member reads their
-- own cards through conversation_agent_access, which leaves the Agent out until it is opened for them.
create policy agent_access_requests_read on public.agent_access_requests for select to authenticated
 using (public.can_open_agent_for(company_id,agent_id,asked_by));
revoke all on public.agent_access_requests from anon,authenticated,service_role;
grant select on public.agent_access_requests to authenticated;

-- 20270415000000's list, with ask_to_open_agent for the main Agent while its person has an Agent hidden from them.
create or replace function public.run_tools(c uuid, agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[
  case when public.may_use_lead_tools(c,agent,person) then 'create_agent' when public.may_ask_lead_for_agents(c,agent,person) then 'request_agent' end,
  case when public.may_hand_to_agent(c,agent,person) then 'hand_to_agent' end,
  case when public.may_tell_agent_rules(c,agent,person) then 'save_rule' when public.may_suggest_agent_rules(c,agent,person) then 'suggest_team_rule' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_draft' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_review' end,
  case when public.may_show_reply_cards(c,agent,person) then 'hand_over' end,
  case when public.may_show_reply_cards(c,agent,person) then 'ask_for_app' end,
  case when public.may_propose_agent_change(c,agent,person) then 'propose_change' end,
  case when public.may_ask_to_open_agents(c,agent,person) then 'ask_to_open_agent' end],null);
$$;

-- 20270408000000's brief, which now also lists the jobs of the Agents hidden from a Manager or a Contributor, each with
-- the first name and Role of the person a card for it would name, and never the Agent's name. One job held by several
-- hidden Agents is listed once.
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
      join public.members m on m.company_id=held.company_id and m.person_id=h.named),'[]'::jsonb) else '[]'::jsonb end)
   where n.conversation_id=conversation and n.send_key=message_key returning * into kept;
 end if;
 return kept.lead_brief;
end $$;

-- Carried out by whoever closes the run (the worker, or a reader): the same run and call again answer the card they
-- kept. A call that cannot be carried out answers as a value, never an error, so its run still closes: one from a
-- Conversation that may not ask is refused, and a job no Agent hidden from that person holds (an Agent they see, one of
-- another Company, or none) is ignored and makes no card.
create function public.agent_ask_to_open(conversation uuid, run text, call text, job text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; target public.hermes_agents; kept public.agent_access_requests; named uuid;
begin
 select * into kept from public.agent_access_requests r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 if found then return jsonb_build_object('state','shown','card',kept.id); end if;
 select * into talk from public.conversations where id=conversation;
 if not found or talk.agent_id is null
  or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not public.may_ask_to_open_agents(talk.company_id,talk.agent_id,talk.person_id) then return jsonb_build_object('state','refused'); end if;
 if nullif(btrim(coalesce(job,'')),'') is null or length(job)>200 then return jsonb_build_object('state','invalid'); end if;
 select * into target from public.agents_hidden_from(talk.company_id,talk.person_id) a
  where lower(btrim(a.speciality))=lower(btrim(job)) order by a.id limit 1;
 if not found then return jsonb_build_object('state','ignored'); end if;
 named:=public.agent_access_named(talk.company_id,talk.person_id,target.id);
 if named is null then return jsonb_build_object('state','ignored'); end if;
 insert into public.agent_access_requests(company_id,conversation_id,run_id,call_id,agent_id,asked_by,named_to)
  values(talk.company_id,conversation,run,call,target.id,talk.person_id,named)
  on conflict (conversation_id,run_id,call_id) do nothing returning * into kept;
 if kept.id is null then
  select * into kept from public.agent_access_requests r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 end if;
 return jsonb_build_object('state','shown','card',kept.id);
end $$;
revoke all on function public.agent_ask_to_open(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.agent_ask_to_open(uuid,text,text,text) to service_role;

-- The card's two buttons, pressed by the person whose Conversation it is, while they may write: "Ask" (ask true) sends
-- the request, "No, never mind" sends nothing. The first press is kept with its time; any later press, from another
-- tab included, changes nothing and answers what the card already says (`first` false).
create function public.press_agent_access(c uuid, request bigint, ask boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare asked public.agent_access_requests;
begin
 if ask is null then raise exception 'agentAccessAnswerMissing' using errcode='22023'; end if;
 select * into asked from public.agent_access_requests r where r.id=request and r.company_id=c and r.asked_by=auth.uid() for update;
 if not found or not public.is_member(c) then raise exception 'agentAccessNotFound' using errcode='P0002'; end if;
 if not public.conversation_can_write(c) then raise exception 'agentAccessNotAllowed' using errcode='42501'; end if;
 if asked.state<>'offered' then return jsonb_build_object('state',asked.state,'at',asked.pressed_at,'first',false); end if;
 update public.agent_access_requests set state=case when ask then 'asked' else 'dismissed' end,pressed_at=now() where id=asked.id returning * into asked;
 return jsonb_build_object('state',asked.state,'at',asked.pressed_at,'first',true);
end $$;
revoke all on function public.press_agent_access(uuid,bigint,boolean) from public,anon,service_role;
grant execute on function public.press_agent_access(uuid,bigint,boolean) to authenticated;

-- An Owner's or a Manager's answer to an asked request: open (#15's switch for that Member and that Agent, through
-- set_agent_visible, which checks the Role again) or no. Every request that Member asked for that same Agent is
-- answered at once, so the item leaves every list. The same answer again answers the same and logs nothing more; the
-- other answer, or an answer to a request that was never asked, is refused. An opening is logged for the team; a no
-- only for its Owners and Managers, as the Member does not see the Agent it names.
create function public.answer_agent_access(c uuid, request bigint, open boolean) returns text
language plpgsql security definer set search_path='' as $$
declare asked public.agent_access_requests; wanted text:=case when open then 'opened' when not open then 'declined' end; asker text;
begin
 if wanted is null then raise exception 'agentAccessAnswerMissing' using errcode='22023'; end if;
 select * into asked from public.agent_access_requests r where r.id=request and r.company_id=c for update;
 if not found then raise exception 'agentAccessNotFound' using errcode='P0002'; end if;
 if not public.can_open_agent_for(c,asked.agent_id,asked.asked_by) then raise exception 'agentAccessNotAllowed' using errcode='42501'; end if;
 if not exists(select 1 from public.members m where m.company_id=c and m.person_id=asked.asked_by and m.removed_at is null) then
  raise exception 'agentAccessNotFound' using errcode='P0002'; end if;
 if asked.state=wanted then return wanted; end if;
 if asked.state<>'asked' then raise exception 'agentAccessAnswered' using errcode='22023'; end if;
 perform 1 from public.agent_access_requests r where r.company_id=c and r.asked_by=asked.asked_by and r.agent_id=asked.agent_id and r.state='asked' for update;
 if open then perform public.set_agent_visible(c,asked.asked_by,asked.agent_id,true); end if;
 update public.agent_access_requests set state=wanted,answered_by=auth.uid(),answered_at=now()
  where company_id=c and asked_by=asked.asked_by and agent_id=asked.agent_id and state='asked';
 asker:=(select name from public.people where id=asked.asked_by);
 perform public.log_agent_event(c,auth.uid(),null,asked.agent_id,case when open then 'AGENT_OPENED_FOR' else 'AGENT_KEPT_HIDDEN' end,
  jsonb_strip_nulls(jsonb_build_object('asked_by',asker,'private',case when open then null else 'managers' end)));
 return wanted;
end $$;
revoke all on function public.answer_agent_access(uuid,bigint,boolean) from public,anon,service_role;
grant execute on function public.answer_agent_access(uuid,bigint,boolean) to authenticated;

-- The cards of one Conversation for its own person: the card's state, who it names (first name, whole name and Role
-- now), when it was pressed, and who answered and when. The Agent is named only once it is opened for that person and
-- they see it now; until then nothing of it is returned.
create function public.conversation_agent_access(conversation uuid)
returns table(id bigint, run_id text, state text, named_first text, named_name text, named_role text, pressed_at timestamptz, answered_at timestamptz,
 answerer text, opened jsonb, created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select r.id, r.run_id, r.state, split_part(coalesce(n.name,''),' ',1), coalesce(n.name,''), coalesce(nm.role::text,''), r.pressed_at, r.answered_at,
  coalesce(a.name,''),
  case when r.state='opened' and public.agent_visible_to(r.company_id,v.person_id,r.agent_id)
   then (select jsonb_build_object('id',g.id,'connection_id',g.connection_id,'name',g.name) from public.hermes_agents g where g.id=r.agent_id) end,
  r.created_at
 from public.agent_access_requests r
 join public.conversations v on v.id=r.conversation_id and v.company_id=r.company_id
 left join public.people n on n.id=r.named_to
 left join public.members nm on nm.company_id=r.company_id and nm.person_id=r.named_to
 left join public.people a on a.id=r.answered_by
 where r.conversation_id=conversation and v.person_id=auth.uid() and r.asked_by=auth.uid() and public.is_member(v.company_id)
  and public.can_see_agent(v.company_id,v.agent_id)
 order by r.id;
$$;
revoke all on function public.conversation_agent_access(uuid) from public,anon,service_role;
grant execute on function public.conversation_agent_access(uuid) to authenticated;

-- Whether an asked request waits on the caller: they may open its Agent for its Member, that Member has not left and
-- does not see the Agent now (switched on in Company settings meanwhile), and it is that Member's first asked request
-- for that Agent, so asking twice waits as one item.
create function public.agent_access_waits(r public.agent_access_requests) returns boolean language sql stable security definer set search_path='' as $$
 select r.state='asked' and public.can_open_agent_for(r.company_id,r.agent_id,r.asked_by)
  and not public.agent_visible_to(r.company_id,r.asked_by,r.agent_id)
  and not exists(select 1 from public.agent_access_requests e where e.company_id=r.company_id and e.asked_by=r.asked_by and e.agent_id=r.agent_id
   and e.state='asked' and e.id<r.id);
$$;
revoke all on function public.agent_access_waits(public.agent_access_requests) from public,anon,service_role;
grant execute on function public.agent_access_waits(public.agent_access_requests) to authenticated;

-- 20270415000000's list, with each asked request that waits on the caller (agent_access_waits): the Agent (title), its
-- job (body) and who asks, since when they asked. A Member who left waits on no one.
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
  union all
  select 'agent_access'::text, r.id, g.name, g.speciality, coalesce(p.name,''), null::bigint, null::uuid, r.pressed_at
   from public.agent_access_requests r
   join public.hermes_agents g on g.company_id=r.company_id and g.id=r.agent_id
   join public.members m on m.company_id=r.company_id and m.person_id=r.asked_by and m.removed_at is null
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and public.agent_access_waits(r)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;
