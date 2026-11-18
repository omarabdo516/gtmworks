-- #148: an Agent called in a channel answers with the same pieces a Conversation's Agent does: a draft card (#136) or a
-- review card (#137) under its reply, and the Run's steps read live from the Hermes session (#346, ADR 0017), never kept.
-- A channel Run is offered show_draft and show_review when the Member who called its Agent may write, whoever else the
-- Agent is hidden from: the channel's own members read the cards and the steps, a Viewer included, and a Member outside
-- the channel reads neither. The tools are pinned with the Run (channel_runs.tools), so a retry sends the same request.
-- Each call is carried out once when the Run closes, into the same reply_cards row a Conversation's card uses, linked to
-- the channel message whose Run carries it, and the #136/#137 log row is written for it too.
--
-- Additive only: one column on channel_runs, one nullable link and its index on reply_cards, three functions, a policy
-- for the card and the channel branch of the log's policy. No row is rewritten, and the previous app version runs against
-- this: it never offers the tools, never calls the new functions and reads reply_cards by its own columns.

alter table public.channel_runs add column tools text;

-- A card keeps a Conversation's link or a channel message's, never both, and the same run and call keep one card either
-- way. The existing unique (conversation_id,run_id,call_id) no longer covers a channel row, whose conversation_id is null.
alter table public.reply_cards alter column conversation_id drop not null;
alter table public.reply_cards add column channel_message_id bigint references public.channel_messages(id);
alter table public.reply_cards add constraint reply_cards_one_place check ((conversation_id is null)<>(channel_message_id is null));
create unique index reply_cards_channel_call on public.reply_cards(channel_message_id,run_id,call_id);

-- A channel's card is read by the channel's members, and by nobody else, as its message is.
create policy reply_cards_channel_read on public.reply_cards for select to authenticated using (
 channel_message_id is not null and exists(select 1 from public.channel_messages m
  where m.id=reply_cards.channel_message_id and m.company_id=reply_cards.company_id and public.in_channel(m.channel_id)));

-- Who may show a card in a channel: the Member whose message called the Agent, while they may write there, and an Agent
-- callable in that channel, even one hidden from them elsewhere (#24). The ticket's rule: whoever called the Agent, as
-- long as that Member may write.
create function public.channel_can_show_cards(ch uuid, person uuid, agent uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.channels k join public.members m on m.company_id=k.company_id
  where k.id=ch and m.person_id=person and m.removed_at is null and m.role<>'viewer')
  and public.channel_agent(ch,person,agent);
$$;
revoke all on function public.channel_can_show_cards(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- The tools a channel Run is offered, pinned at its first start as a Conversation's are (pin_run): show_draft and
-- show_review only, as the text gtmworks sends, when the Member who called its Agent may write. A retry finds them
-- pinned and sends the same request. Returns null for a Run that ended or has no message, and `{tools:null}` when the
-- Member is not offered a card tool. `tools` is text holding the JSON array, as conversation_run_notes.tools is.
create function public.pin_channel_run(message bigint, specs jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs; m public.channel_messages; offered text[];
begin
 select * into r from public.channel_runs where message_id=message for update;
 if r.message_id is null or r.outcome is not null then return null; end if;
 if r.tools is null then
  select * into m from public.channel_messages where id=message;
  if m.id is null or m.author<>'person' then return null; end if;
  if public.channel_can_show_cards(r.channel_id,m.person_id,r.agent_id) then
   offered:=array(select t from unnest(array['show_draft','show_review']) t where jsonb_typeof(specs->t)='string');
   update public.channel_runs set tools=case when cardinality(offered)>0 then
     '['||(select string_agg(specs->>t,',' order by o) from unnest(offered) with ordinality u(t,o))||']' end
    where message_id=message returning * into r;
  end if;
 end if;
 return jsonb_build_object('tools',r.tools);
end $$;
revoke all on function public.pin_channel_run(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.pin_channel_run(bigint,jsonb) to service_role;

-- A draft or review call of a channel Run, carried out by whoever closes it (the worker, or a reader): the same message,
-- run and call again answer the card it showed, also when a second closer carries it out. What the model wrote never
-- raises: a card that does not hold is answered invalid, so its Run still closes. The card links to the channel message
-- whose Run carries it, and the first call writes the #136/#137 log row, read by the channel's members.
create function public.channel_show_card(message bigint, run text, call text, kind text, title text, content jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.channel_runs; m public.channel_messages; kept public.reply_cards;
begin
 select * into kept from public.reply_cards c where c.channel_message_id=message and c.run_id=run and c.call_id=call;
 if found then return jsonb_build_object('state','shown','card',kept.id); end if;
 select * into r from public.channel_runs where message_id=message;
 select * into m from public.channel_messages where id=message;
 if r.message_id is null or m.id is null or m.author<>'person' or r.run_id is distinct from run
  or kind not in ('draft','review')
  or not public.channel_can_show_cards(r.channel_id,m.person_id,r.agent_id) then return jsonb_build_object('state','refused'); end if;
 if not (public.reply_card_text(to_jsonb(title),100) and public.reply_card_valid(kind,'shown',content)) then
  return jsonb_build_object('state','invalid'); end if;
 insert into public.reply_cards(company_id,channel_message_id,run_id,call_id,kind,title,content,state)
  values(r.company_id,message,run,call,kind,title,content,'shown')
  on conflict (channel_message_id,run_id,call_id) do nothing returning * into kept;
 if kept.id is null then
  select * into kept from public.reply_cards c where c.channel_message_id=message and c.run_id=run and c.call_id=call;
 else
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
   values(r.company_id,r.agent_id,'agent',(select name from public.hermes_agents where id=r.agent_id),'agent',r.agent_id,'agent_card_shown',
    jsonb_build_object('card',jsonb_build_object('kind',kept.kind,'title',kept.title)||case when kept.kind='review' then
      (select jsonb_build_object('fine',count(*) filter (where i->'fine'='true'::jsonb),'edits',count(*) filter (where i->'fine'='false'::jsonb))
       from jsonb_array_elements(kept.content->'items') i) else '{}'::jsonb end,
     'private',true,'teller',m.person_id),
    'reply_cards',kept.id,kept.created_at)
   on conflict (source,source_id) do nothing;
 end if;
 return jsonb_build_object('state','shown','card',kept.id);
end $$;
revoke all on function public.channel_show_card(bigint,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.channel_show_card(bigint,text,text,text,text,jsonb) to service_role;

-- The sessions a channel's replies were made in, for their steps (#346): one row per completed Run that has a reply,
-- with the profile it ran on, read by the channel's members only. A member reads the steps of a reply they can read,
-- also when the Agent is hidden from them elsewhere. The steps are read live from that session; gtmworks keeps none.
-- `after` starts the list at a message id.
create function public.channel_run_sessions(ch uuid, after bigint default 0)
returns table(message_id bigint, agent_id uuid, profile text, session uuid)
language sql stable security definer set search_path='' as $$
 select r.message_id,r.agent_id,r.profile,r.session from public.channel_runs r
 where r.channel_id=ch and auth.uid() is not null and public.in_channel(ch) and r.message_id>coalesce(after,0)
  and r.outcome='completed' and r.agent_id is not null and r.profile is not null and r.session is not null
  and exists(select 1 from public.channel_messages m where m.reply_to=r.message_id and m.author='agent');
$$;
revoke all on function public.channel_run_sessions(uuid,bigint) from public,anon,service_role;
grant execute on function public.channel_run_sessions(uuid,bigint) to authenticated;

-- A channel card's log row is read by the channel's members, also when the Agent is hidden from them elsewhere; every
-- other row keeps the rule it had (20261223000000).
alter policy company_log_read on public.company_log using (
 (public.is_member(company_id) and public.can_see_agent(company_id,agent_id) and public.can_see_agent(company_id,actor_id)
  and (details->>'private' is null or actor_id=auth.uid() or details->>'teller'=auth.uid()::text
   or case when details->>'private'='owners' then public.is_company_owner(company_id) else public.can_manage_company(company_id) end))
 or (source='reply_cards' and exists(select 1 from public.reply_cards c join public.channel_messages m on m.id=c.channel_message_id
  where c.id=company_log.source_id and c.company_id=company_log.company_id and public.in_channel(m.channel_id))));
