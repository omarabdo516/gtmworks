-- #137: the review card, the second kind of reply card (#136). A reviewing Agent gives one verdict per reviewed text (the
-- text, fine or not, a note) and then its decision, shown with show_review. A review changes nothing: it records no
-- Approval, moves no Card and adds no Version (ADR 0006). It adds a branch to reply_card_valid, a fourth run_tools slot,
-- and the review's counts to its log row; no table.
--
-- Nothing existing is rewritten: the draft branch is unchanged and a draft's log row is as before. The previous app
-- version runs against this: its tool texts have no show_review, so pin_run never offers it there, and its reader leaves
-- out a review row.

-- What each kind holds and which states it takes: the one list of kinds, since a kind with no branch is never valid.
-- Branches are only ever added: the table's check does not judge stored rows again when this is replaced, so a kind's
-- branch must never get narrower.
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
 end,false);
$$;

-- The fourth slot: any Agent's runs with an Owner, a Manager or a Contributor are offered show_review after show_draft.
create or replace function public.run_tools(c uuid, agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[
  case when public.may_use_lead_tools(c,agent,person) then 'create_agent' when public.may_ask_lead_for_agents(c,agent,person) then 'request_agent' end,
  case when public.may_tell_agent_rules(c,agent,person) then 'save_rule' when public.may_suggest_agent_rules(c,agent,person) then 'suggest_rule' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_draft' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_review' end],null);
$$;

-- As #136's, and a review's log row also says how many reviewed texts are fine and how many need an edit.
create or replace function public.agent_show_card(conversation uuid, run text, call text, kind text, title text, content jsonb) returns jsonb
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
