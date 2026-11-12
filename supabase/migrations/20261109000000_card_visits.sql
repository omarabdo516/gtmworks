create table public.work_card_visits (
 company_id uuid not null references public.companies(id),
 person_id uuid not null references public.people(id),
 card_id bigint not null,
 opened_at timestamptz not null default clock_timestamp(),
 primary key(company_id,person_id,card_id),
 foreign key(company_id,card_id) references public.work_cards(company_id,id) on delete cascade
);
create index work_card_visits_recent on public.work_card_visits(company_id,person_id,opened_at desc,card_id desc);
alter table public.work_card_visits enable row level security;
create policy card_visits_read on public.work_card_visits for select to authenticated using (person_id=auth.uid() and (public.is_member(company_id) or public.agency_access()));
create policy card_visits_insert on public.work_card_visits for insert to authenticated with check (person_id=auth.uid() and (public.is_member(company_id) or public.agency_access()));
create policy card_visits_update on public.work_card_visits for update to authenticated using (person_id=auth.uid() and (public.is_member(company_id) or public.agency_access())) with check (person_id=auth.uid() and (public.is_member(company_id) or public.agency_access()));
create function public.stamp_card_visit() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='UPDATE' and (new.company_id,new.person_id,new.card_id) is distinct from (old.company_id,old.person_id,old.card_id) then raise exception 'visit identity cannot change'; end if;
 new.opened_at=clock_timestamp();
 return new;
end $$;
create trigger stamp_card_visit before insert or update on public.work_card_visits for each row execute function public.stamp_card_visit();
