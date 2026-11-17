-- #139: the "Handed to you" card, the fourth kind of reply card (#136). An Agent hands its person a step no Agent may do
-- (publishing, paying, sending to a customer: ADR 0006, 0008) with hand_over: the app the step is done in, a title, one
-- line, label and value rows, the address of its draft when it has one, and a closing note. The card is open until the
-- Conversation's person presses "Done it" once (mark_hand_done), which records who and when and logs it privately, as
-- #136's card is. gtmworks does not do the step and checks nothing outside: "Done it" is the person's word. The press
-- approves, publishes and spends nothing.
--
-- Nothing existing is rewritten: the draft, review and question branches are unchanged, and the new columns are empty
-- on every row there. The previous app version runs against this: its tool texts have no hand_over, so pin_run never
-- offers it there; its reader leaves out a hand row; it selects its columns by name and never calls mark_hand_done.

-- What each kind holds and which states it takes. Branches are only ever added: the table's check does not judge stored
-- rows again when this is replaced, so a kind's branch must never get narrower. A hand card's address, when given, is an
-- https one with no spaces (its scheme in any case, as schemes are), so the link the person opens is never a script or
-- another scheme.
create or replace function public.reply_card_valid(kind text, state text, content jsonb) returns boolean language sql immutable set search_path='' as $$
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
     and jsonb_typeof(content->'answer')='string' and length(content->>'answer') between 1 and 20000 and btrim(content->>'answer',E' \t\r\n')<>''
    else false end
   and public.reply_card_text(content->'question',4000)
   and jsonb_typeof(content->'multiple')='boolean'
   and case when jsonb_typeof(content->'choices')='array' then jsonb_array_length(content->'choices')<=4
    and not exists(select 1 from jsonb_array_elements(content->'choices') o where not coalesce(jsonb_typeof(o)='string'
     and length(o#>>'{}') between 1 and 1000 and btrim(o#>>'{}',E' \t\r\n')<>'',false)) else false end
  else false end
  when 'hand' then state in ('open','done') and case when jsonb_typeof(content)='object' then
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
 end,false);
$$;

-- Who said they did a handed step, and when. A card holds them exactly when it is a hand card marked done.
alter table public.reply_cards add column done_by uuid references public.people(id), add column done_at timestamptz;
alter table public.reply_cards add constraint reply_cards_done check ((done_by is null)=(done_at is null) and (done_at is not null)=(kind='hand' and state='done'));

-- The fifth slot: any Agent's runs with an Owner, a Manager or a Contributor are offered hand_over after show_review.
create or replace function public.run_tools(c uuid, agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[
  case when public.may_use_lead_tools(c,agent,person) then 'create_agent' when public.may_ask_lead_for_agents(c,agent,person) then 'request_agent' end,
  case when public.may_tell_agent_rules(c,agent,person) then 'save_rule' when public.may_suggest_agent_rules(c,agent,person) then 'suggest_rule' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_draft' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_review' end,
  case when public.may_show_reply_cards(c,agent,person) then 'hand_over' end],null);
$$;

-- As #137's, and a hand card is judged and kept open, waiting for its person's "Done it"; every other kind is shown. A
-- hand card writes no row here: its one log row is its person's "Done it" (mark_hand_done), as #139 asks.
create or replace function public.agent_show_card(conversation uuid, run text, call text, kind text, title text, content jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; kept public.reply_cards; opened text:=case when kind='hand' then 'open' else 'shown' end;
begin
 select * into kept from public.reply_cards r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 if found then return jsonb_build_object('state','shown','card',kept.id); end if;
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run)
  or not public.may_show_reply_cards(talk.company_id,talk.agent_id,talk.person_id) then return jsonb_build_object('state','refused'); end if;
 if not (public.reply_card_text(to_jsonb(title),100) and public.reply_card_valid(kind,opened,content)) then return jsonb_build_object('state','invalid'); end if;
 insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state)
  values(talk.company_id,conversation,run,call,kind,title,content,opened)
  on conflict (conversation_id,run_id,call_id) do nothing returning * into kept;
 if kept.id is null then
  select * into kept from public.reply_cards r where r.conversation_id=conversation and r.run_id=run and r.call_id=call;
 elsif kept.kind<>'hand' then
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
   values(talk.company_id,talk.agent_id,'agent',(select name from public.hermes_agents where id=talk.agent_id),'agent',talk.agent_id,'agent_card_shown',
    jsonb_build_object('card',jsonb_build_object('kind',kept.kind,'title',kept.title)||case when kept.kind='review' then
      (select jsonb_build_object('fine',count(*) filter (where i->'fine'='true'::jsonb),'edits',count(*) filter (where i->'fine'='false'::jsonb))
       from jsonb_array_elements(kept.content->'items') i) else '{}'::jsonb end,
     'private',true,'teller',talk.person_id),'reply_cards',kept.id,kept.created_at)
   on conflict (source,source_id) do nothing;
 end if;
 return jsonb_build_object('state','shown','card',kept.id);
end $$;

-- The one "Done it", by the Conversation's own person (never a Viewer, who writes nothing): the first press records who
-- and when and logs it once, privately; any later press, from any tab, answers that first record and changes nothing.
-- `first` says which, so only the page whose press recorded it plays the settle.
create function public.mark_hand_done(c uuid, conversation uuid, card bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; handed public.reply_cards;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into talk from public.conversations v where v.id=conversation and v.company_id=c;
 if not found or talk.person_id<>auth.uid() or not public.can_see_agent(c,talk.agent_id) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into handed from public.reply_cards r where r.id=card and r.conversation_id=conversation and r.kind='hand' for update;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if handed.state='done' then return jsonb_build_object('state','done','at',handed.done_at,'first',false); end if;
 update public.reply_cards set state='done',done_by=auth.uid(),done_at=now() where id=handed.id returning * into handed;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(handed.company_id,auth.uid(),'person',(select name from public.people where id=auth.uid()),'agent',talk.agent_id,'agent_hand_done',
   jsonb_build_object('hand',jsonb_build_object('title',handed.title),'private',true,'teller',auth.uid()),'reply_card_answers',handed.id,handed.done_at)
  on conflict (source,source_id) do nothing;
 return jsonb_build_object('state','done','at',handed.done_at,'first',true);
end $$;
revoke all on function public.mark_hand_done(uuid,uuid,bigint) from public,anon,service_role;
grant execute on function public.mark_hand_done(uuid,uuid,bigint) to authenticated;
