-- #136: an Agent's reply carries a card, not only words. Every card any kind of reply carries is one reply_cards row,
-- kept for its Conversation, run and call when the run closes, as the made Agent (#13) and the saved rule (#18) are. A
-- later kind (the review card #137, the question card #138, "Handed to you" #139, the Connect card #203) adds a branch to
-- reply_card_valid, a run_tools slot when gtmworks offers it a tool, and its component; never a table. The first kind is
-- the draft: a title, one line under it and up to eight label and value rows, shown with show_draft. A draft changes
-- nothing: it approves, publishes and spends nothing (ADR 0006). The made Agent, the saved rule, the suggestion and the
-- request keep their own tables.
--
-- Nothing existing is rewritten. The previous app version runs against this: its tool texts have no show_draft, so
-- pin_run never offers it there, and it never reads reply_cards.

-- One text of a card: a string, trimmed, of 1 to `most` characters.
create function public.reply_card_text(value jsonb, most int) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(value)='string' and value#>>'{}'=btrim(value#>>'{}',E' \t\r\n') and length(value#>>'{}') between 1 and most,false);
$$;
revoke all on function public.reply_card_text(jsonb,int) from public,anon,authenticated,service_role;

-- What each kind holds and which states it takes: the one list of kinds, since a kind with no branch is never valid.
-- Branches are only ever added: the table's check does not judge stored rows again when this is replaced, so a kind's
-- branch must never get narrower.
create function public.reply_card_valid(kind text, state text, content jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(case kind
  when 'draft' then state='shown' and case when jsonb_typeof(content)='object' then
   (select array_agg(k order by k) from jsonb_object_keys(content) k)=array['line','rows']
   and public.reply_card_text(content->'line',160)
   and case when jsonb_typeof(content->'rows')='array' then jsonb_array_length(content->'rows')<=8
    and not exists(select 1 from jsonb_array_elements(content->'rows') r where not case when jsonb_typeof(r)='object' then
     (select array_agg(k order by k) from jsonb_object_keys(r) k)=array['label','value']
     and public.reply_card_text(r->'label',40) and public.reply_card_text(r->'value',240) else false end) else false end
  else false end
 end,false);
$$;
revoke all on function public.reply_card_valid(text,text,jsonb) from public,anon,authenticated,service_role;

-- Whom an Agent may show a card: an active Owner, Manager or Contributor of the Company the Agent works in, who sees that
-- Agent (#15). A Viewer starts no run. It decides both whether a run is offered a card tool and whether its call is
-- carried out.
create function public.may_show_reply_cards(c uuid, agent uuid, person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role in ('owner','manager','contributor') and m.removed_at is null)
  and exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c) and public.agent_visible_to(c,person,agent);
$$;
revoke all on function public.may_show_reply_cards(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- `id` is what a later action on a card names; the Conversation, run and call keep one card per call. `state` is what
-- became of the card since it was shown: a draft stays shown.
create table public.reply_cards (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 conversation_id uuid not null,
 run_id text not null,
 call_id text not null,
 kind text not null,
 title text not null,
 content jsonb not null,
 state text not null default 'shown',
 created_at timestamptz not null default now(),
 unique (conversation_id,run_id,call_id),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id),
 constraint reply_cards_title check (public.reply_card_text(to_jsonb(title),100)),
 constraint reply_cards_kind check (public.reply_card_valid(kind,state,content))
);
-- A Conversation is private to its person, so its cards are too, while they are a Member who sees its Agent
-- (conversation_attachments_read). Only agent_show_card writes one.
alter table public.reply_cards enable row level security;
create policy reply_cards_read on public.reply_cards for select to authenticated using (exists(
 select 1 from public.conversations c where c.id=reply_cards.conversation_id and c.company_id=reply_cards.company_id
  and c.person_id=auth.uid() and public.is_member(c.company_id) and public.can_see_agent(c.company_id,c.agent_id)));
revoke all on public.reply_cards from public,anon,authenticated,service_role;
grant select on public.reply_cards to authenticated;

-- The third slot: any Agent's runs with an Owner, a Manager or a Contributor are offered show_draft.
create or replace function public.run_tools(c uuid, agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[
  case when public.may_use_lead_tools(c,agent,person) then 'create_agent' when public.may_ask_lead_for_agents(c,agent,person) then 'request_agent' end,
  case when public.may_tell_agent_rules(c,agent,person) then 'save_rule' when public.may_suggest_agent_rules(c,agent,person) then 'suggest_rule' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_draft' end],null);
$$;

-- A card call of a completed run, carried out by whoever closes it (the worker, or a reader): the same run and call
-- again answer the card they showed. What the model wrote never raises: a card that does not hold is answered invalid,
-- so its run still closes. Only the call that stored the card logs it, privately as #25's rows are, until the chat has a
-- Card (#144).
create function public.agent_show_card(conversation uuid, run text, call text, kind text, title text, content jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; kept public.reply_cards;
begin
 select * into kept from public.reply_cards r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 if found then return jsonb_build_object('state','shown','card',kept.id); end if;
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not public.may_show_reply_cards(talk.company_id,talk.agent_id,talk.person_id) then return jsonb_build_object('state','refused'); end if;
 if not (public.reply_card_text(to_jsonb(title),100) and public.reply_card_valid(kind,'shown',content)) then return jsonb_build_object('state','invalid'); end if;
 insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content)
  values(talk.company_id,conversation,run,call,kind,title,content)
  on conflict (conversation_id,run_id,call_id) do nothing returning * into kept;
 if kept.id is null then
  select * into kept from public.reply_cards r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 else
  insert into public.hermes_agent_audit(company_id,actor_id,actor_name,agent_id,action,details)
   values(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),talk.agent_id,'AGENT_CARD_SHOWN',
    jsonb_build_object('card',jsonb_build_object('kind',kept.kind,'title',kept.title),'card_id',kept.id,'conversation_id',conversation,'private',true,'teller',talk.person_id));
 end if;
 return jsonb_build_object('state','shown','card',kept.id);
end $$;
revoke all on function public.agent_show_card(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.agent_show_card(uuid,text,text,text,text,jsonb) to service_role;

-- The log copies the card's kind and title, the same key for every kind. log_agent_action already names the action
-- (agent_card_shown).
create or replace function public.log_agent_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),coalesce(new.actor_name,(select name from public.people where id=new.actor_id)),
   'agent',new.agent_id,public.log_agent_action(new.action),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=new.agent_id),'replacement_id',new.details->'replacement_id','job',new.details->'job','rule',new.details->'rule','taught_by',new.details->'taught_by','asked_for',new.details->'asked_for','asked_by',new.details->'asked_by','reason',new.details->'reason','private',new.details->'private','teller',new.details->'teller','card',new.details->'card')),
   'hermes_agent_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
