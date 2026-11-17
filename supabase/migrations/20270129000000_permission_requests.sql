-- #163: the permission request card, the fifth kind of reply card (#136). A Run stops to ask its person before an action
-- (the Engine's own consent prompt, Hermes's waiting_for_approval) and waits for "Allow once", "Always allow" or "Don't
-- allow". One reply_cards row of kind permission per request: its call_id is the Engine's request id, its content the
-- Engine's own words (already redacted by it) and the choices it accepts, and `state` its life: open (asked), sending (the
-- person's choice is claimed and stored), then decided (the Engine took it) or closed (the Engine stopped waiting: its
-- own time limit, a stop, the Run's end). A sending card is drawn decided. It is not an Approval: that is a decision on a
-- Card's version (decide_approval), and nothing here touches one.
--
-- Four functions own every transition, as #138's three own a question's: track_run_permission (whoever closes Runs, on
-- each read), decide_permission (the Conversation's person, the one claim), settle_permission (whoever delivered the
-- choice), and a Run's end closes what is left. Who may send which choice is permission_choices, the one place the rule
-- lives: once and deny for a Contributor, and always too for an Owner or a Manager, since it changes what the Agent may
-- do from then on. The Engine keeps "always" in the profile the Run ran on, so it is kept as a choice only when that is the
-- Agent's own profile (ADR 0016): on the Company's shared one it would let every Agent there do it. A decision the Engine
-- took is logged once, privately, as a question's answer is.
--
-- Nothing existing is rewritten: every earlier branch of reply_card_valid is unchanged and the new columns are empty on
-- every row there. The previous app version runs against this: its driver never reports a request, so nothing calls the
-- new functions; its reader leaves out a permission row; it selects its columns by name.

-- What each kind holds and which states it takes. Branches are only ever added: the table's check does not judge stored
-- rows again when this is replaced, so a kind's branch must never get narrower. A permission request holds the Engine's
-- description and command (either may be blank, not both) and the choices it accepts, once and deny always among them;
-- once decided, also the choice, which must be one of them.
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
 end,false);
$$;

-- Who decided a request, and when (the first press). A card holds them exactly when it holds a choice.
alter table public.reply_cards add column decided_by uuid references public.people(id), add column decided_at timestamptz;
alter table public.reply_cards add constraint reply_cards_decided check ((decided_by is null)=(decided_at is null)
 and (decided_at is not null)=(kind='permission' and content ? 'choice'));

-- The choices the caller may send in Company c: none for a Viewer or anyone who is not a Member, once and deny for a
-- Contributor, and always too for a Manager or the Owner. decide_permission checks it, and the Conversation's record
-- reads it to draw the buttons.
create function public.permission_choices(c uuid) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce((select case when m.role in ('owner','manager') then array['once','always','deny'] when m.role='contributor' then array['once','deny'] end
  from public.members m where m.company_id=c and m.person_id=auth.uid() and m.removed_at is null),'{}'::text[]);
$$;
revoke all on function public.permission_choices(uuid) from public,anon,service_role;
grant execute on function public.permission_choices(uuid) to authenticated;

-- Whoever closes a Run tells the database what each read of it showed: the request it waits on (`asking`,
-- {id,description,command,choices}, or null), whether it has ended, when the read began and when it ended, and the Engine
-- profile it read the Run on (`run_profile`). Always is kept only when that profile is the Agent's own, and never when
-- none is named. The Agent's Connection is not asked: an Agent moved to its own profile while its Run on the shared one
-- waits would keep always, and the Engine would widen every Agent there. The request is kept
-- once, as of the read's end (a read may begin before another and end after it, so its start may predate a later read that
-- found nothing yet),
-- its title the description, or the command when that is blank. An open or claimed card of the Run closes when the Run
-- has ended, a claimed one with its choice kept, since nothing can deliver to an ended Run; an open one also closes when
-- a read that began after the card was kept no longer shows it (a read that began earlier may predate it); an open or
-- claimed card of a Run the record has closed closes too. It answers the Run's claimed choices still to deliver.
create function public.track_run_permission(conversation uuid, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz default null, run_profile text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked text:=asking->>'id'; own boolean; kept jsonb; named text;
begin
 -- The lock a Run's end takes (close_ended_run_permissions), so a request is never kept after its Run has ended.
 perform pg_advisory_xact_lock(hashtextextended('permission_run:'||conversation::text||':'||run,0));
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run) then return '[]'::jsonb; end if;
 update public.reply_cards r set state='closed' where r.conversation_id=conversation and r.kind='permission'
  and (r.run_id=run and (ended and r.state in ('open','sending') or r.state='open' and r.call_id is distinct from asked and r.created_at<read_started_at)
   or r.state in ('open','sending') and r.run_id<>run and exists(select 1 from public.conversation_usage u where u.conversation_id=conversation and u.run_id=r.run_id));
 if asked is not null and not ended and not exists(select 1 from public.conversation_usage u where u.conversation_id=conversation and u.run_id=run) then
  own:=coalesce(run_profile=public.agent_engine_profile(talk.agent_id),false);
  kept:=jsonb_build_object('description',asking->'description','command',asking->'command','choices',
   case when jsonb_typeof(asking->'choices')='array' then coalesce((select jsonb_agg(o order by n) from jsonb_array_elements(asking->'choices') with ordinality x(o,n)
    where own or o<>'"always"'::jsonb),'[]'::jsonb) else asking->'choices' end);
  if length(asked) between 1 and 200 and public.reply_card_valid('permission','open',kept) then
   named:=btrim(case when btrim(kept->>'description',E' \t\r\n')<>'' then kept->>'description' else kept->>'command' end,E' \t\r\n');
   insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at)
    values(talk.company_id,conversation,run,asked,'permission',
     case when length(named)<=100 then named else rtrim(left(named,99),E' \t\r\n')||'…' end,kept,'open',greatest(read_started_at,coalesce(read_ended_at,read_started_at)))
    on conflict do nothing;
  end if;
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('card',r.id,'permission',r.call_id,'choice',r.content->'choice') order by r.id) from public.reply_cards r
  where r.conversation_id=conversation and r.run_id=run and r.kind='permission' and r.state='sending'),'[]'::jsonb);
end $$;
revoke all on function public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text) to service_role;

-- The one claim, by the Conversation's own person (never a Viewer, who writes nothing), of a choice their role may send
-- and the Engine offered. The first press is kept; every later one, from any tab, and one for a request the Engine no
-- longer waits on, answers what really happened and changes nothing. `first` says which, so only the page whose press
-- was kept plays the settle.
create function public.decide_permission(c uuid, conversation uuid, card bigint, choice text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked public.reply_cards;
begin
 if not public.conversation_can_write(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 select * into talk from public.conversations v where v.id=conversation and v.company_id=c;
 if not found or talk.person_id<>auth.uid() or not public.can_see_agent(c,talk.agent_id) then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 select * into asked from public.reply_cards r where r.id=card and r.conversation_id=conversation and r.kind='permission' for update;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if asked.state in ('sending','decided') then
  return jsonb_build_object('state','decided','choice',asked.content->'choice','at',asked.decided_at,'first',false); end if;
 if asked.state<>'open' then return jsonb_build_object('state','closed','choice',null,'at',null,'first',false); end if;
 -- A slower closer may have kept this request after another ended its Run: nothing waits for it any more.
 if exists(select 1 from public.conversation_usage u where u.conversation_id=conversation and u.run_id=asked.run_id) then
  update public.reply_cards set state='closed' where id=asked.id;
  return jsonb_build_object('state','closed','choice',null,'at',null,'first',false);
 end if;
 if decide_permission.choice is null or not asked.content->'choices' ? decide_permission.choice then raise exception 'permissionChoiceInvalid' using errcode='22023'; end if;
 if not decide_permission.choice=any(public.permission_choices(c)) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 update public.reply_cards set state='sending',content=asked.content||jsonb_build_object('choice',decide_permission.choice),decided_by=auth.uid(),decided_at=now()
  where id=asked.id returning * into asked;
 return jsonb_build_object('state','decided','choice',decide_permission.choice,'at',asked.decided_at,'first',true);
end $$;
revoke all on function public.decide_permission(uuid,uuid,bigint,text) from public,anon,service_role;
grant execute on function public.decide_permission(uuid,uuid,bigint,text) to authenticated;

-- What became of a delivered choice: decided (the Engine took it) or closed (it no longer waited). A delivery the Engine
-- took wins over a closed card that holds the same choice (the Run's end, or another closer's "gone"); a closed verdict
-- never undoes a decided one. Only a decided one is logged, once: who decided, the Agent, what was asked and the choice,
-- private to the person and the Company's Owners and Managers.
create function public.settle_permission(card bigint, verdict text) returns text
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
    (select v.agent_id from public.conversations v where v.id=asked.conversation_id),'agent_permission_decided',
    jsonb_build_object('permission',jsonb_build_object('text',case when btrim(asked.content->>'description',E' \t\r\n')<>'' then asked.content->'description' else asked.content->'command' end,
     'choice',asked.content->'choice'),'private',true,'teller',asked.decided_by),
    'reply_card_answers',asked.id,asked.decided_at)
   on conflict (source,source_id) do nothing;
 end if;
 return verdict;
end $$;
revoke all on function public.settle_permission(bigint,text) from public,anon,authenticated;
grant execute on function public.settle_permission(bigint,text) to service_role;

-- A Run's end (its conversation_usage row) closes its open and claimed requests in that transaction, under
-- track_run_permission's lock: nothing can deliver a choice to an ended Run, so a claimed one closes with it kept.
create function public.close_ended_run_permissions() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('permission_run:'||new.conversation_id::text||':'||new.run_id,0));
 update public.reply_cards set state='closed' where conversation_id=new.conversation_id and run_id=new.run_id and kind='permission' and state in ('open','sending');
 return null;
end $$;
revoke all on function public.close_ended_run_permissions() from public,anon,authenticated,service_role;
create trigger conversation_usage_closes_permissions after insert on public.conversation_usage for each row execute function public.close_ended_run_permissions();
