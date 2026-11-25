-- #679 (spec #668, ADR 0026): a Card's description is Markdown text with a version number. It is read drawn (headings,
-- lists, to-do items, quotes, links, tables, images, code), and a to-do is ticked while reading: ticking is its own
-- operation on one item, safe when the text changed meanwhile, and one quiet row of the Card's Activity. Writing the
-- description on the page is #680's; unticked items never stop a Card from being finished (no rule reads them). Only
-- adds (ADR 0023): the previous release never reads these columns.

alter table public.work_cards add column description text not null default '';
alter table public.work_cards add column description_version integer not null default 0;
alter table public.work_cards add constraint work_cards_description_size check (octet_length(description) <= 200000);

-- 1. The to-do items of a description, one row per item in the order they are read: the line it is on (1-based), its
-- text after the box, and whether it is ticked. A line inside a fenced code block is never an item. The app's own reading
-- (lib/card-description.mjs todoItems) follows the same rules, so the count the board shows and the item a tick names
-- are the same item.
create function public.card_todos(body text)
returns table(line integer, item text, done boolean) language plpgsql immutable set search_path='' as $$
declare n integer:=0; l text; fence text:=null; m text[]; begin
 foreach l in array string_to_array(coalesce(body,''),E'\n') loop
  n=n+1;
  m=regexp_match(l,'^\s{0,3}(`{3,}|~{3,})(.*)$');
  if fence is not null then
   -- A fence closes on a line of the same character, at least as long, with nothing after it.
   if m is not null and left(m[1],1)=left(fence,1) and length(m[1])>=length(fence) and btrim(m[2])='' then fence=null; end if;
   continue;
  end if;
  if m is not null then fence=m[1]; continue; end if;
  m=regexp_match(l,'^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\](?:\s+|$))(.*)$');
  if m is not null then line=n; item=btrim(m[4]); done=m[2]<>' '; return next; end if;
 end loop;
end $$;
revoke all on function public.card_todos(text) from public,anon,authenticated,service_role;
grant execute on function public.card_todos(text) to authenticated;

-- 2. Tick or untick one to-do. The reader names the item by the line they saw it on and its text: when the text moved
-- meanwhile (someone wrote above it), the one item with that text is ticked wherever it now is; when it is gone or now
-- ambiguous, the tick is refused and nothing changes. A tick that is already so changes nothing and logs nothing. It
-- writes its own Activity row, so it runs as its owner and checks the reader itself: one who may edit the Company's work,
-- on a Card they see (can_see_card) that is not archived; another Company's Card is not found.
create function public.tick_card_todo(c uuid, card bigint, line integer, item text, done boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.work_cards; target integer; lines text[]; found_count integer; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 select * into w from public.work_cards x where x.company_id=c and x.id=card for update;
 if not found or w.archived_at is not null or not public.can_see_card(c,card) then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 select t.line into target from public.card_todos(w.description) t where t.line=tick_card_todo.line and t.item=btrim(tick_card_todo.item);
 if target is null then
  select count(*), min(t.line) into found_count, target from public.card_todos(w.description) t where t.item=btrim(tick_card_todo.item);
  if found_count<>1 then raise exception 'to-do changed' using errcode='P0001'; end if;
 end if;
 if exists(select 1 from public.card_todos(w.description) t where t.line=target and t.done=tick_card_todo.done) then
  return jsonb_build_object('version',w.description_version,'line',target,'changed',false);
 end if;
 lines=string_to_array(w.description,E'\n');
 lines[target]=regexp_replace(lines[target],'^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)[ xX](\])','\1'||case when done then 'x' else ' ' end||'\2');
 update public.work_cards x set description=array_to_string(lines,E'\n'), description_version=x.description_version+1
  where x.company_id=c and x.id=card;
 insert into public.work_activity(company_id,card_id,actor_id,action,details)
  values(c,card,auth.uid(),'todo_ticked',jsonb_build_object('item',btrim(tick_card_todo.item),'done',done));
 return jsonb_build_object('version',w.description_version+1,'line',target,'changed',true);
end $$;
revoke all on function public.tick_card_todo(uuid,bigint,integer,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.tick_card_todo(uuid,bigint,integer,text,boolean) to authenticated;
