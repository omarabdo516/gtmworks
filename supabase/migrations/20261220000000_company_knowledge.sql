-- #27: one Company knowledge per Company, what every Agent of the Company must know, in five parts: brand voice,
-- audience, products and prices, banned claims and decisions, in that order (lib/company-knowledge.mjs). Every Member,
-- a Viewer included, reads it; an active Owner or Manager edits a part through save_company_knowledge, which keeps who
-- edited it and when. Each edit is kept in company_audit beside renames and copied into the Company's log, naming the
-- part and whether it was cleared. Every run of the Company's Agents is given the parts' text as it was at the run's
-- first start (pin_run_knowledge, beside pin_run), so a retry sends the request it first sent and the next run the
-- latest text.
--
-- Nothing existing is rewritten. The previous app version never reads the knowledge, reads its log rows as another
-- change to the Company, and pins none: a run it already tried to start is told no knowledge when this version retries
-- it.

-- The parts, in the order a reader and a run get them.
create function public.company_knowledge_parts() returns text[] language sql immutable set search_path='' as $$
 select array['voice','audience','products','banned','decisions'];
$$;
revoke all on function public.company_knowledge_parts() from public,anon,authenticated,service_role;

-- A cleared part keeps its row, with an empty body and who cleared it when.
create table public.company_knowledge (
 company_id uuid not null references public.companies(id) on delete cascade,
 part text not null check (part=any(public.company_knowledge_parts())),
 body text not null check (length(body)<=20000),
 edited_by uuid references public.people(id),
 edited_at timestamptz not null default now(),
 primary key (company_id,part)
);
alter table public.company_knowledge enable row level security;
create policy company_knowledge_read on public.company_knowledge for select to authenticated using (public.is_member(company_id));
revoke all on public.company_knowledge from anon,authenticated,service_role;
grant select on public.company_knowledge to authenticated;

alter table public.company_audit drop constraint company_audit_action_check;
alter table public.company_audit add constraint company_audit_action_check check (action in ('company_renamed','agent_level_changed','company_knowledge_changed'));
alter table public.company_audit add column knowledge_part text, add column knowledge_cleared boolean;
alter table public.company_audit drop constraint company_audit_values;
alter table public.company_audit add constraint company_audit_values check (
 (action='company_renamed' and old_name is not null and new_name is not null)
 or (action='agent_level_changed' and old_level between 1 and 3 and new_level between 1 and 3)
 or (action='company_knowledge_changed' and knowledge_part is not null and knowledge_cleared is not null));

create or replace function public.log_company_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
  values(new.company_id,new.actor_id,public.log_actor_kind(new.company_id,new.actor_id),(select name from public.people where id=new.actor_id),
   'company',new.action,case new.action when 'agent_level_changed' then jsonb_build_object('old_level',new.old_level,'new_level',new.new_level)
    when 'company_knowledge_changed' then jsonb_build_object('part',new.knowledge_part,'cleared',new.knowledge_cleared)
    else jsonb_build_object('old_name',new.old_name,'new_name',new.new_name) end,'company_audit',new.id,new.created_at)
  on conflict (source,source_id) do nothing;
 return null;
end;
$$;
revoke all on function public.log_company_change() from public,anon,authenticated,service_role;

-- An active Owner or Manager saves one part. The text is trimmed; an empty one clears the part. The same text as stored
-- changes nothing and logs nothing, and answers false. Refusals carry a key the screen shows.
create function public.save_company_knowledge(c uuid, part text, body text) returns boolean
language plpgsql security definer set search_path='' as $$
declare piece text:=save_company_knowledge.part; kept text:=btrim(coalesce(save_company_knowledge.body,''),E' \t\r\n'); stored text;
begin
 if not public.can_manage_company(c) then raise exception 'companyKnowledgeNotAllowed' using errcode='42501'; end if;
 if piece is null or array_position(public.company_knowledge_parts(),piece) is null then raise exception 'companyKnowledgeInvalid' using errcode='22023'; end if;
 if length(kept)>20000 then raise exception 'companyKnowledgeTooLong' using errcode='22023'; end if;
 if public.secret_like(kept) then raise exception 'companyKnowledgeSecret' using errcode='22023'; end if;
 -- Two saves of one part never pass each other: the second compares its text with what the first stored.
 perform pg_advisory_xact_lock(hashtextextended('company_knowledge:'||c::text||':'||piece,0));
 select k.body into stored from public.company_knowledge k where k.company_id=c and k.part=piece;
 if coalesce(stored,'')=kept then return false; end if;
 insert into public.company_knowledge(company_id,part,body,edited_by) values (c,piece,kept,auth.uid())
  on conflict on constraint company_knowledge_pkey do update set body=excluded.body,edited_by=excluded.edited_by,edited_at=now();
 insert into public.company_audit(company_id,actor_id,action,knowledge_part,knowledge_cleared) values (c,auth.uid(),'company_knowledge_changed',piece,kept='');
 return true;
end $$;
revoke all on function public.save_company_knowledge(uuid,text,text) from public,anon,service_role;
grant execute on function public.save_company_knowledge(uuid,text,text) to authenticated;

-- A run's knowledge is pinned at its first start, like its tools and rules (pin_run): the Company's parts that have
-- text, in order, as [{part,body}]. A run already tried (an attempt or an unknown start on its reservation, whose row is
-- locked as begin_start counts one) keeps what it was pinned with, and one the previous app version tried is told none.
alter table public.conversation_run_notes add column knowledge jsonb;
create function public.pin_run_knowledge(conversation uuid, message_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare held public.conversation_run_reservations; kept public.conversation_run_notes;
begin
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key for update;
 select * into kept from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if kept.conversation_id is null then return '[]'::jsonb; end if;
 if kept.knowledge is null and held.conversation_id is not null and held.start_attempts=0 and held.start_unknown_at is null then
  update public.conversation_run_notes n set knowledge=(select coalesce(jsonb_agg(jsonb_build_object('part',k.part,'body',k.body) order by array_position(public.company_knowledge_parts(),k.part)),'[]'::jsonb)
    from public.company_knowledge k where k.company_id=held.company_id and k.body<>'')
   where n.conversation_id=conversation and n.send_key=message_key returning * into kept;
 end if;
 return coalesce(kept.knowledge,'[]'::jsonb);
end $$;
revoke all on function public.pin_run_knowledge(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pin_run_knowledge(uuid,uuid) to service_role;
