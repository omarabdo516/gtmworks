-- #680 (spec #668, ADR 0026): the description is written on the page and saves by itself. A save states the version it
-- read; when the description moved on meanwhile (another person, or a tick), the save is refused with the newer text and
-- the text of the version it read, and the app merges the two by lines and saves again: changes to different lines both
-- stay, and a line both changed keeps both. Every version is kept so a merge always has the text its writer read. Only
-- adds (ADR 0023): the previous release never reads these.

create table public.work_card_description_versions(
 company_id uuid not null,
 card_id bigint not null,
 version integer not null,
 body text not null,
 saved_by uuid references public.people(id) on delete set null,
 saved_at timestamptz not null default now(),
 primary key (card_id,version),
 foreign key (company_id,card_id) references public.work_cards(company_id,id) on delete cascade
);
alter table public.work_card_description_versions enable row level security;
revoke all on public.work_card_description_versions from anon,authenticated;
grant select on public.work_card_description_versions to authenticated;
create policy work_read on public.work_card_description_versions for select to authenticated using (public.is_member(company_id));
create policy card_agent_visible on public.work_card_description_versions as restrictive for select to authenticated using (public.can_see_card(company_id,card_id));

-- 1. Every version a description reaches is kept, however it was written (a save, a tick, a Card made with one).
create function public.keep_description_version()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.description_version is distinct from old.description_version or new.description is distinct from old.description then
  insert into public.work_card_description_versions(company_id,card_id,version,body,saved_by) values(new.company_id,new.id,new.description_version,new.description,auth.uid())
   on conflict (card_id,version) do update set body=excluded.body, saved_by=excluded.saved_by, saved_at=now();
 end if;
 return null;
end $$;
revoke all on function public.keep_description_version() from public,anon,authenticated,service_role;
create trigger work_cards_keep_description after insert or update of description,description_version on public.work_cards for each row execute function public.keep_description_version();
insert into public.work_card_description_versions(company_id,card_id,version,body)
 select company_id,id,description_version,description from public.work_cards on conflict do nothing;

-- 2. Save the description over the version its writer read. Saved: the new version. Moved on: nothing changes, and the
-- answer carries the newer text and version and the text of the version read, for the app to merge. One Activity row per
-- writer and Card within ten minutes, so writing a paragraph is not a page of the log.
create function public.save_card_description(c uuid, card bigint, body text, base integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.work_cards; read text; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 select * into w from public.work_cards x where x.company_id=c and x.id=card for update;
 if not found or w.archived_at is not null or not public.can_see_card(c,card) then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 if octet_length(coalesce(body,''))>200000 then raise exception 'description too long' using errcode='22023'; end if;
 if w.description_version<>base then
  select v.body into read from public.work_card_description_versions v where v.card_id=card and v.version=base;
  return jsonb_build_object('saved',false,'version',w.description_version,'body',w.description,'base',read);
 end if;
 if coalesce(body,'')=w.description then return jsonb_build_object('saved',true,'version',w.description_version,'body',w.description); end if;
 update public.work_cards x set description=coalesce(body,''), description_version=x.description_version+1 where x.company_id=c and x.id=card;
 if not exists(select 1 from public.work_activity a where a.company_id=c and a.card_id=card and a.actor_id=auth.uid() and a.action='description_changed' and a.created_at>now()-interval '10 minutes') then
  insert into public.work_activity(company_id,card_id,actor_id,action,details) values(c,card,auth.uid(),'description_changed','{}'::jsonb);
 end if;
 return jsonb_build_object('saved',true,'version',w.description_version+1,'body',coalesce(body,''));
end $$;
revoke all on function public.save_card_description(uuid,bigint,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.save_card_description(uuid,bigint,text,integer) to authenticated;
