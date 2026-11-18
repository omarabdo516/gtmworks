-- #203: the "Connect X" card, the sixth kind of reply card (#136). An Agent that needs an app on gtmworks's list asks for
-- it with ask_for_app: the app's key and one line of its own reason. The worker shows the card only when the Agent's
-- profile does not have the app connected (lib/agent-tools.mjs asks the Engine first). The card keeps the key and the
-- reason; whether the app is connected is never kept here, as the Engine is the only record of it (#30) and the
-- Conversation reads it whenever it draws the card. The one state kept is the Owner's "Later" (postpone_app_card), which
-- writes no log row. "Connect" is #30's own sign-in route, Owner only and logged there. The card approves, publishes and
-- spends nothing (ADR 0006).
--
-- Nothing existing is rewritten: every earlier branch of reply_card_valid is unchanged. The previous app version runs
-- against this: its tool texts have no ask_for_app, so pin_run never offers it there; its reader leaves out a connect row;
-- it selects its columns by name and never calls postpone_app_card.

-- As 20270129's, and a connect card: open, or postponed by the Owner; the key of an app as #30 writes it, and a reason of
-- at most 200 characters.
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
   and coalesce(jsonb_typeof(content->'app')='string' and content->>'app' ~ '^[a-z][a-z0-9-]{0,63}$',false)
   and public.reply_card_text(content->'reason',200)
  else false end
 end,false);
$$;

-- The sixth slot: any Agent's runs with an Owner, a Manager or a Contributor are offered ask_for_app after hand_over.
create or replace function public.run_tools(c uuid, agent uuid, person uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[
  case when public.may_use_lead_tools(c,agent,person) then 'create_agent' when public.may_ask_lead_for_agents(c,agent,person) then 'request_agent' end,
  case when public.may_tell_agent_rules(c,agent,person) then 'save_rule' when public.may_suggest_agent_rules(c,agent,person) then 'suggest_rule' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_draft' end,
  case when public.may_show_reply_cards(c,agent,person) then 'show_review' end,
  case when public.may_show_reply_cards(c,agent,person) then 'hand_over' end,
  case when public.may_show_reply_cards(c,agent,person) then 'ask_for_app' end],null);
$$;

-- As 20270128's, and a connect card is kept open, as a hand card is, and writes no log row: the only row it ever leads to
-- is #30's connect.
create or replace function public.agent_show_card(conversation uuid, run text, call text, kind text, title text, content jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; kept public.reply_cards; opened text:=case when kind in ('hand','connect') then 'open' else 'shown' end;
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
 elsif kept.kind not in ('hand','connect') then
  perform public.log_chat_event(conversation,talk.agent_id,'agent',(select name from public.hermes_agents where id=talk.agent_id),'agent_card_shown',
   jsonb_build_object('card',jsonb_build_object('kind',kept.kind,'title',kept.title)||case when kept.kind='review' then
     (select jsonb_build_object('fine',count(*) filter (where i->'fine'='true'::jsonb),'edits',count(*) filter (where i->'fine'='false'::jsonb))
      from jsonb_array_elements(kept.content->'items') i) else '{}'::jsonb end),
   talk.person_id,'reply_cards',kept.id,kept.created_at);
 end if;
 return jsonb_build_object('state','shown','card',kept.id);
end $$;

-- "Later" on a connect card, by the Conversation's own person while they are an active Owner of the Company (only the
-- Owner connects apps, #30): the card is postponed for good, from any tab, and nothing else changes. No log row is
-- written. `first` says whether this press postponed it.
create function public.postpone_app_card(c uuid, conversation uuid, card bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked public.reply_cards;
begin
 if not public.is_company_owner(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into talk from public.conversations v where v.id=conversation and v.company_id=c;
 if not found or talk.person_id<>auth.uid() or not public.can_see_agent(c,talk.agent_id) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into asked from public.reply_cards r where r.id=card and r.conversation_id=conversation and r.kind='connect' for update;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if asked.state='postponed' then return jsonb_build_object('state','postponed','first',false); end if;
 update public.reply_cards set state='postponed' where id=asked.id;
 return jsonb_build_object('state','postponed','first',true);
end $$;
revoke all on function public.postpone_app_card(uuid,uuid,bigint) from public,anon,service_role;
grant execute on function public.postpone_app_card(uuid,uuid,bigint) to authenticated;
