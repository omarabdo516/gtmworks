-- #151 A channel made for a piece of work has its Card on the board. The first Run of an Agent called in a team channel
-- puts one Card under "In progress", titled with the channel's name, with the Agent called and tied to the channel
-- (design-reference: teamTurn's dropNewCard); the general channel never gets one. The channel gets one quiet line saying
-- the Card was added under "In progress", and the log gets one row by gtmworks: "added a card from the channel". A
-- later Agent that answers in the channel is logged on the Card, so the Card's "Worked on it:" lists it (#311, crew).
-- Only the database ties a Card to a channel: no Member and no key sets, moves or removes the tie.
-- Additive: one nullable link and its index on work_cards, one link on channel_notes, two triggers, three helpers and
-- two log sources. Nothing the previous app version calls changes: it posts the same messages, starts the same Runs and
-- reads the same columns; a Card made here reads as a Card it made.
-- Kept apart from the channel Run functions on purpose: close_channel_run, post_channel_message, begin_channel_start and
-- channel_runs_due are #150's to redefine, so this ticket makes its Card from a trigger instead.

alter table public.work_cards add column channel_id uuid,
 add constraint work_cards_channel_fkey foreign key (channel_id, company_id) references public.channels(id, company_id)
  on delete set null (channel_id);
create unique index work_cards_one_per_channel on public.work_cards(channel_id) where channel_id is not null;
-- A Card belongs to a Conversation or to a channel, never both (a Card with neither is an ordinary Card).
alter table public.work_cards add constraint work_cards_one_place check (conversation_id is null or channel_id is null);

-- The quiet line a channel gets when its Card is added, as #207's invitation line: not a message, no writer, no Run.
alter table public.channel_notes add column card_id bigint references public.work_cards(id) on delete cascade;
alter table public.channel_notes alter column invitee_name drop not null;
alter table public.channel_notes drop constraint channel_notes_kind_check;
alter table public.channel_notes add constraint channel_notes_kind_check check (kind in ('invite','card'));
-- An invitation line names the invited person; a Card line names its Card. An invitation withdrawn leaves its line.
alter table public.channel_notes add constraint channel_notes_shape check (kind='card' or invitee_name is not null);
create unique index channel_notes_one_card on public.channel_notes(card_id) where card_id is not null;

alter table public.company_log drop constraint company_log_source_check;
alter table public.company_log add constraint company_log_source_check check (source in
 ('work_activity','work_comments','member_audit','hermes_agent_audit','company_audit','note_runs','reply_cards',
  'member_invitations','reply_card_answers','channel_permissions','agent_handovers','channel_handover_replies','channel_cards','channel_replies'));

-- The Card of a team channel, made by the first Run an Agent called in it starts (design-reference: teamTurn): the
-- Company's first stage In progress, the channel's name, the Agent called, tied to the channel. One Run per Agent of a
-- message (#152) and one Card per channel: the later Runs and messages find it and change nothing. The quiet line and
-- the log row are written with it, once. The general channel keeps no Card, and a Company with no In progress stage keeps
-- none either. A Card is work for the board: it lists in "Worked on it" each Agent logged on it (#311).
create function public.channel_run_card() returns trigger language plpgsql security definer set search_path='' as $$
declare k public.channels; stage bigint; made public.work_cards; line bigint;
begin
 select * into k from public.channels where id=new.channel_id and company_id=new.company_id;
 if k.id is null or k.kind<>'team' then return null; end if;
 select s.id into stage from public.work_stages s
  where s.company_id=k.company_id and s.board_column='progress' and s.kind='before_review'
  order by s.position,s.id limit 1;
 if stage is null then return null; end if;
 insert into public.work_cards(company_id,stage_id,title,agent_id,channel_id)
  values (k.company_id,stage,coalesce(k.name,''),new.agent_id,k.id)
  on conflict (channel_id) where channel_id is not null do nothing returning * into made;
 if made.id is null then return null; end if;
 insert into public.channel_notes(company_id,channel_id,kind,card_id,actor_name)
  values (k.company_id,k.id,'card',made.id,'') on conflict (card_id) where card_id is not null do nothing returning id into line;
 insert into public.company_log(company_id,actor_id,actor_kind,subject,card_id,action,details,source,source_id,created_at)
  values (k.company_id,null,'system','card',made.id,'channel_card_added',
   jsonb_build_object('channel_id',k.id,'channel',k.name),'channel_cards',made.id,now())
  on conflict (source,source_id) do nothing;
 return null;
end $$;
revoke all on function public.channel_run_card() from public,anon,authenticated,service_role;
create trigger channel_runs_card after insert on public.channel_runs for each row execute function public.channel_run_card();

-- An Agent that answered in a channel with a Card is logged on it, so the Card's "Worked on it:" names every Agent that
-- took part (#311: crew reads the log). A reply in the general channel, or in a channel with no Card, logs nothing.
create function public.channel_reply_card() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,details,source,source_id,created_at)
  select new.company_id,new.agent_id,'agent',new.author_name,'card',w.id,new.agent_id,'channel_reply','{}'::jsonb,
   'channel_replies',new.id,new.created_at
  from public.work_cards w where w.company_id=new.company_id and w.channel_id=new.channel_id
  on conflict (source,source_id) do nothing;
 return null;
end $$;
revoke all on function public.channel_reply_card() from public,anon,authenticated,service_role;
create trigger channel_messages_card after insert on public.channel_messages
 for each row when (new.author='agent' and new.reply_to is not null) execute function public.channel_reply_card();

-- Only the database ties a Card to a channel, as #144's guard keeps a Conversation's tie. The trigger above runs as its
-- owner, so it sets the link; no Member and no key does.
create function public.guard_card_channel() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated','service_role')
  and (tg_op='INSERT' and new.channel_id is not null or tg_op='UPDATE' and new.channel_id is distinct from old.channel_id) then
  raise exception 'cardChannelProtected' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_card_channel() from public,anon,authenticated,service_role;
create trigger work_card_channel_guard before insert or update of channel_id on public.work_cards
 for each row execute function public.guard_card_channel();

-- The Card a channel put on the board, as its reader reads it: the one Card tied to the channel, its title, the column it
-- stands in now (Waiting on you while its stage is a review stage), the line under it, and whether it waits. A Member who
-- does not see the Card's Agent reads none, as the board hides it (#190); a channel with no Card answers nothing. Read as
-- the caller.
create function public.channel_board_card(ch uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare k public.channels; w public.work_cards; s public.work_stages; right_now text; next_item text; total int; done int;
begin
 if ch is null or auth.uid() is null or not public.channel_member(ch,auth.uid()) then return null; end if;
 select * into k from public.channels where id=ch;
 if k.id is null then return null; end if;
 select * into w from public.work_cards where channel_id=ch and company_id=k.company_id;
 if w.id is null or not public.can_see_agent(k.company_id,w.agent_id) then return null; end if;
 select * into s from public.work_stages where company_id=k.company_id and id=w.stage_id;
 right_now:=coalesce(s.board_column,'ideas');
 if right_now='waiting' then
  next_item:=coalesce(public.card_wait(w)->>'title',s.name);
 elsif right_now='progress' then
  select count(*),count(*) filter (where i.done) into total,done from public.work_checklist i
   where i.company_id=k.company_id and i.card_id=w.id;
  if total>0 then
   select i.title into next_item from public.work_checklist i
    where i.company_id=k.company_id and i.card_id=w.id and not i.done order by i.id limit 1;
  end if;
 end if;
 return jsonb_build_object('card',w.id,'title',w.title,'column',right_now,
  'line',coalesce(case when right_now='progress' and total>0 and next_item is not null then next_item||' · '||round(100.0*done/total)::int||'%'
   when right_now='progress' and total>0 then round(100.0*done/total)::int||'%'
   when right_now='waiting' then next_item else s.name end,''),
  'waiting',right_now='waiting');
end $$;
revoke all on function public.channel_board_card(uuid) from public,anon,service_role;
grant execute on function public.channel_board_card(uuid) to authenticated;
