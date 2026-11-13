-- "Waiting on you" is one list (#16): everything that needs one person, newest first. Two sources feed it through
-- one function, waiting_list(c):
--  * approvals: a card in review whose current step this person holds (derived, as before; deciding removes it);
--  * waiting_items: anything else addressed to one Member, by kind. An Agent's question is the first kind; later kinds
--    (mentions, Agent requests, change proposals, learning suggestions) are rows of their own kind in the same table and
--    need no change to the list or its screen.
-- An item leaves the list when its person acts where it came from: a reply in its Conversation, or any change they
-- make on its Card. Nothing here sends anything outside gtmworks: no webhook, no mail, no notification is queued.

create table public.waiting_items (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 person_id uuid not null,
 kind text not null check (kind ~ '^[a-z][a-z_]{0,39}$' and kind<>'approval'),
 title text not null check (length(btrim(title)) between 1 and 300),
 body text not null default '' check (length(body)<=4000),
 asked_by text not null default '' check (length(asked_by)<=120),
 card_id bigint,
 conversation_id uuid,
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 foreign key (company_id,person_id) references public.members(company_id,person_id),
 foreign key (company_id,card_id) references public.work_cards(company_id,id),
 foreign key (conversation_id,company_id) references public.conversations(id,company_id),
 check (card_id is not null or conversation_id is not null)
);
create index waiting_items_open on public.waiting_items(company_id,person_id) where resolved_at is null;
alter table public.waiting_items enable row level security;
-- Each person reads only what is addressed to them, in a Company they still belong to. Rows are written by the
-- functions below only.
create policy waiting_items_read on public.waiting_items for select to authenticated using (person_id=auth.uid() and public.is_member(company_id));
revoke all on table public.waiting_items from anon,authenticated;
grant select on table public.waiting_items to authenticated;

-- The server (the engine side, with the service role) adds an item. A question asked in a Conversation goes to that
-- Conversation's person only.
create function public.add_waiting_item(c uuid, person uuid, item_kind text, item_title text, item_body text default '', card bigint default null, conversation uuid default null, asker text default '')
returns bigint language plpgsql security definer set search_path='' as $$
declare result bigint; begin
 if not exists(select 1 from public.members where company_id=c and person_id=person and removed_at is null) then raise exception 'not a member' using errcode='22023'; end if;
 if conversation is not null and not exists(select 1 from public.conversations where id=conversation and company_id=c and person_id=person) then raise exception 'conversation not found' using errcode='P0002'; end if;
 insert into public.waiting_items(company_id,person_id,kind,title,body,asked_by,card_id,conversation_id)
  values(c,person,item_kind,btrim(item_title),coalesce(item_body,''),coalesce(asker,''),card,conversation) returning id into result;
 return result;
end $$;
revoke all on function public.add_waiting_item(uuid,uuid,text,text,text,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.add_waiting_item(uuid,uuid,text,text,text,bigint,uuid,text) to service_role;

-- The one list, read as the signed-in person.
create function public.waiting_list(c uuid)
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
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$$;
revoke all on function public.waiting_list(uuid) from public,anon,service_role;
grant execute on function public.waiting_list(uuid) to authenticated;

-- Acting where an item came from clears it: a reply in its Conversation, or a change by its person on its Card.
create function public.resolve_waiting_on_reply() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.waiting_items set resolved_at=now() where conversation_id=new.conversation_id and person_id=new.person_id and resolved_at is null;
 return new;
end $$;
revoke all on function public.resolve_waiting_on_reply() from public,anon,authenticated,service_role;
create trigger resolve_waiting_on_reply after insert on public.conversation_messages for each row when (new.author='person') execute function public.resolve_waiting_on_reply();

create function public.resolve_waiting_on_card() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.waiting_items set resolved_at=now() where company_id=new.company_id and card_id=new.card_id and person_id=new.actor_id and resolved_at is null;
 return new;
end $$;
revoke all on function public.resolve_waiting_on_card() from public,anon,authenticated,service_role;
create trigger resolve_waiting_on_card after insert on public.work_activity for each row when (new.actor_id is not null) execute function public.resolve_waiting_on_card();
