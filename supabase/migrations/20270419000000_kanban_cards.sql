-- Spec #831 (#836): a Card is a task on the Company's Engine's own Kanban board, and gtmworks keeps no copy of it (ADR
-- 0033). It keeps one small row beside a Card, only when there is something about people to hold: the Member who is its
-- Assignee (a Card given to a Member has no Agent on the Engine, so the dispatcher never starts it), its publishing date,
-- and the person who made it. The Company is on the row and its policies go by Role (ADR 0004): any Member reads the rows
-- of their Company, an Owner, a Manager or a Contributor writes one, and nobody else; a row's Card is the Engine's task
-- `task_id` on that Company's Engine. A person never removes a row: one whose task is gone from the Engine is forgotten by
-- the worker's slow drift check (ADR 0031 item 4), through the two functions below, which only the worker may call.
--
-- Nothing existing is changed: a new table and two new functions, which the previous app version never calls.
create table public.kanban_cards (
 company_id uuid not null references public.companies(id) on delete cascade,
 task_id text not null check (task_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 assignee uuid references public.people(id) on delete set null,
 publish_on date,
 made_by uuid references public.people(id) on delete set null,
 created_at timestamptz not null default now(),
 primary key (company_id,task_id)
);
alter table public.kanban_cards enable row level security;
revoke all on public.kanban_cards from anon,authenticated,service_role;
grant select,insert on public.kanban_cards to authenticated;
-- Who made the Card, its Company and its task are written once; the Assignee and the publishing date change.
grant update (assignee,publish_on) on public.kanban_cards to authenticated;
create policy kanban_cards_read on public.kanban_cards for select to authenticated using (public.is_member(company_id));
-- The Assignee is an active Member of the Card's Company, or nobody; who made it is the writer, or nobody (a Card an
-- Agent made, given to a Member later).
create policy kanban_cards_insert on public.kanban_cards for insert to authenticated with check (public.work_can_edit(company_id)
 and (made_by is null or made_by=auth.uid())
 and (assignee is null or exists(select 1 from public.members m where m.company_id=kanban_cards.company_id and m.person_id=kanban_cards.assignee and m.removed_at is null)));
create policy kanban_cards_update on public.kanban_cards for update to authenticated using (public.work_can_edit(company_id)) with check (public.work_can_edit(company_id)
 and (assignee is null or exists(select 1 from public.members m where m.company_id=kanban_cards.company_id and m.person_id=kanban_cards.assignee and m.removed_at is null)));

-- The drift check's list: each Company's rows by task id, in order.
create function public.kanban_card_tasks() returns table(company_id uuid, tasks text[])
language sql stable security definer set search_path='' as $$
 select k.company_id,array_agg(k.task_id order by k.task_id) from public.kanban_cards k group by k.company_id order by k.company_id;
$$;
-- Forgets the rows of one Company whose tasks the Engine no longer holds; answers how many.
create function public.forget_kanban_cards(c uuid, tasks text[]) returns integer
language sql security definer set search_path='' as $$
 with gone as (delete from public.kanban_cards k where k.company_id=c and k.task_id=any(tasks) returning 1) select count(*)::integer from gone;
$$;
revoke all on function public.kanban_card_tasks() from public,anon,authenticated;
revoke all on function public.forget_kanban_cards(uuid,text[]) from public,anon,authenticated;
grant execute on function public.kanban_card_tasks() to service_role;
grant execute on function public.forget_kanban_cards(uuid,text[]) to service_role;
