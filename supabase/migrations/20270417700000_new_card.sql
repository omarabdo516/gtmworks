-- #683 (spec #668, ADR 0026): one New card form, for the toolbar's button and the Ideas column: a title, a description,
-- an assignee or nobody, and the Project the board is filtered by. A Card lands in Planned from the button and at the top of
-- Ideas from there. Made once per request key, so a double press or a retry is one Card. Only adds (ADR 0023): the
-- previous release keeps its own ways of making a Card until the cutover.

alter table public.work_cards add column request_key uuid;
create unique index work_cards_request_key on public.work_cards(company_id,request_key) where request_key is not null;

create function public.new_card(c uuid, card_title text, status text, description text default '', agent uuid default null, person uuid default null, project bigint default null, request_key uuid default null)
returns bigint language plpgsql set search_path='' as $$
declare made bigint; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 if btrim(coalesce(card_title,''))='' then raise exception 'title required' using errcode='22023'; end if;
 if new_card.status not in ('ideas','planned','progress') then raise exception 'unknown column' using errcode='22023'; end if;
 if octet_length(coalesce(description,''))>200000 then raise exception 'description too long' using errcode='22023'; end if;
 if project is not null and not exists(select 1 from public.work_projects p where p.company_id=c and p.id=project) then raise exception 'project not found'; end if;
 if request_key is not null then
  select w.id into made from public.work_cards w where w.company_id=c and w.request_key=new_card.request_key;
  if made is not null then return made; end if;
 end if;
 if new_card.status='ideas' then perform set_config('work.idea','yes',true); end if;
 insert into public.work_cards(company_id,status,title,description,project_id,request_key,board_order)
  values(c,new_card.status,btrim(card_title),coalesce(description,''),project,request_key,
   case when new_card.status='ideas' then coalesce((select min(w.board_order) from public.work_cards w where w.company_id=c and w.status='ideas' and w.archived_at is null),1)-1 end)
  returning id into made;
 perform set_config('work.idea','',true);
 if agent is not null or person is not null then perform public.assign_card(c,made,agent,person); end if;
 return made;
end $$;
revoke all on function public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.new_card(uuid,text,text,text,uuid,uuid,bigint,uuid) to authenticated;
