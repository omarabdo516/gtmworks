-- #714: a step an Agent stopped at on its own Screen (spec #710). The hand card (#139) gains one key, `screen`, only ever
-- true: the Agent handed the step over with "on my screen", so the card's second button opens that Agent's Screen, where
-- its person does the step and presses "Done it", the same mark_hand_done as the chat card's. The Conversation's person
-- alone finds the open step on the Agent's Screen (screen_hands): its banner, the Screen's waiting state and line, and the
-- toast when it arrives. Every other Member, a Viewer included, sees the Screen as usual.
--
-- Additive: the hand branch of reply_card_valid accepts one more key and narrows nothing (a branch is only ever added
-- to, as 20270116000000 says), and one new function. The previous app version sends no `screen`, reads a card's keys by
-- name and calls nothing new.

-- 20270415999992's, with the hand branch taking `screen` true beside its other keys.
create or replace function public.reply_card_valid(kind text, state text, content jsonb) returns boolean
language sql immutable set search_path='' as $$
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
     and case jsonb_typeof(content->'answer')
      when 'string' then length(content->>'answer') between 1 and 20000 and btrim(content->>'answer',E' \t\r\n')<>''
      -- Several picks (#648): only on a question where several may be picked, each one of its choices, once.
      when 'array' then coalesce((content->>'multiple')::boolean,false) and jsonb_array_length(content->'answer')>=1
       and jsonb_typeof(content->'choices')='array' and (content->'choices') @> (content->'answer')
       and not exists(select 1 from jsonb_array_elements(content->'answer') a where jsonb_typeof(a)<>'string')
       and (select count(distinct a) from jsonb_array_elements(content->'answer') a)=jsonb_array_length(content->'answer')
      else false end
    else false end
   and public.reply_card_text(content->'question',4000)
   and jsonb_typeof(content->'multiple')='boolean'
   and case when jsonb_typeof(content->'choices')='array' then jsonb_array_length(content->'choices')<=4
    and not exists(select 1 from jsonb_array_elements(content->'choices') o where not coalesce(jsonb_typeof(o)='string'
     and length(o#>>'{}') between 1 and 1000 and btrim(o#>>'{}',E' \t\r\n')<>'',false)) else false end
  else false end
  when 'hand' then state in ('open','done','closed') and case when jsonb_typeof(content)='object' then
   (select array_agg(k order by k) from jsonb_object_keys(content) k where k<>'screen') in
    (array['app','line','rows'],array['app','line','rows','url'],array['app','line','note','rows'],array['app','line','note','rows','url'])
   and public.reply_card_text(content->'app',40)
   and public.reply_card_text(content->'line',160)
   and case when jsonb_typeof(content->'rows')='array' then jsonb_array_length(content->'rows')<=8
    and not exists(select 1 from jsonb_array_elements(content->'rows') r where not case when jsonb_typeof(r)='object' then
     (select array_agg(k order by k) from jsonb_object_keys(r) k)=array['label','value']
     and public.reply_card_text(r->'label',40) and public.reply_card_text(r->'value',240) else false end) else false end
   and (not content ? 'url' or coalesce(jsonb_typeof(content->'url')='string' and content->>'url' ~* '^https://[^[:space:]]+$' and length(content->>'url')<=2000,false))
   and (not content ? 'note' or public.reply_card_text(content->'note',240))
   -- #714: a step the Agent stopped at on its own Screen; the key is there only as true.
   and (not content ? 'screen' or content->'screen'='true'::jsonb)
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
   and coalesce(jsonb_typeof(content->'app')='string' and content->>'app' ~ '^[a-z][a-z0-9_-]{0,63}$',false)
   and public.reply_card_text(content->'reason',200)
  else false end
 end,false);
$$;


-- The open steps on an Agent's Screen handed to the caller in this Company, newest first: each in a Conversation that is
-- the caller's own, with an Agent they see, not archived. A Viewer writes nothing and presses no "Done it", so has none.
create function public.screen_hands(c uuid) returns table(card bigint, conversation uuid, agent uuid, agent_name text, title text, app text, created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select r.id,v.id,v.agent_id,h.name,r.title,r.content->>'app',r.created_at
 from public.reply_cards r
 join public.conversations v on v.id=r.conversation_id
 join public.hermes_agents h on h.id=v.agent_id and h.company_id=c
 where r.company_id=c and v.company_id=c and r.kind='hand' and r.state='open' and r.content->'screen'='true'::jsonb
  and v.person_id=auth.uid() and v.archived_at is null
  and public.conversation_can_write(c) and public.can_see_agent(c,v.agent_id)
 order by r.id desc
 limit 20;
$$;
revoke all on function public.screen_hands(uuid) from public,anon,service_role;
grant execute on function public.screen_hands(uuid) to authenticated;
