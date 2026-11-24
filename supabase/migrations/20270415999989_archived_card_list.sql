-- #705: the board's archive list (#670) is read a page at a time, newest archived first, and searched by title, as All
-- conversations is (conversation_list, 20270415999995). A page holds at most 100 Cards; the next one starts after the
-- last Card of the page before (`after_at`, `after_id`). `q` keeps the Cards whose title holds it, read through
-- search_fold, so a search reads every archived title, not only those shown. The board's Agent and Project filters are
-- asked here too (`agent`, `project`), so a filtered list pages on as an unfiltered one does. Only the archived Cards of
-- a Company the reader is a Member of and sees are read, as archived_cards (20270415999991) reads them; that function
-- stays the read of an archived Card by its id.
-- Every version after the two migrations this one reads (archive_cards' archived_at, 20270415999991, and
-- all_conversations' search_fold, 20270415999993) is taken up to the staged cutover, which must sort last
-- (tests/staged-migrations.test.mjs; #743). So it comes before them, and both functions are PL/pgSQL, which reads the
-- names in its body when it is called, not when it is made.
create function public.archived_card_list(c uuid, q text default null, agent uuid default null, project bigint default null,
 after_at timestamptz default null, after_id bigint default null, lim integer default 50)
returns setof public.work_cards
language plpgsql stable security definer set search_path='' as $$
begin
 return query select w.* from public.work_cards w, (select nullif(public.search_fold(coalesce(q,'')),'') as fold) wanted
 where w.company_id=c and w.archived_at is not null and public.is_member(c) and public.can_see_card(c,w.id)
  and (agent is null or w.agent_id=agent) and (project is null or w.project_id=project)
  and (after_at is null or (w.archived_at,w.id)<(after_at,after_id))
  and (wanted.fold is null or position(wanted.fold in public.search_fold(w.title))>0)
 order by w.archived_at desc, w.id desc
 limit least(greatest(coalesce(lim,50),1),100);
end $$;
revoke all on function public.archived_card_list(uuid,text,uuid,bigint,timestamptz,bigint,integer) from public,anon,service_role;
grant execute on function public.archived_card_list(uuid,text,uuid,bigint,timestamptz,bigint,integer) to authenticated;

-- How many archived Cards the reader sees in Company `c`: the count on the board's archive icon, which no page holds.
create function public.archived_card_count(c uuid) returns integer
language plpgsql stable security definer set search_path='' as $$
begin
 return (select count(*)::int from public.work_cards w
  where w.company_id=c and w.archived_at is not null and public.is_member(c) and public.can_see_card(c,w.id));
end $$;
revoke all on function public.archived_card_count(uuid) from public,anon,service_role;
grant execute on function public.archived_card_count(uuid) to authenticated;
