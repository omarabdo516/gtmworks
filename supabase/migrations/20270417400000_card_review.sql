-- #681 (spec #668, ADR 0026): a Card in review shows its Version with Approve and Send back with a reason, and any Owner
-- or Manager who sees the Card decides it on that exact Version; the first answer closes it. Approved goes to Planned
-- with the approved symbol when its publishing date is ahead, else to Done; sent back goes to In progress with the reason
-- as a comment. A later Version needs its own Approval, and an Agent never approves (only a signed-in Owner or Manager
-- does). Approval steps are gone from the app: a Card already waiting on one is a review for every Owner and Manager who
-- sees it. This closes #513. Only adds (ADR 0023): the previous release keeps its approval steps until the cutover
-- (#684), and what it does with them is kept in step with the reviews here.

-- 1. A review: asked on one Version (none for a Card moved over from an approval step before it had one), answered once,
-- or ended unanswered when its Card is archived (restoring it starts nothing, #667).
create table public.work_reviews(
 id bigint generated always as identity primary key,
 company_id uuid not null,
 card_id bigint not null,
 version_id bigint references public.work_versions(id) on delete set null,
 asked_by uuid references public.people(id) on delete set null,
 asked_at timestamptz not null default now(),
 decision text check (decision in ('approved','sent_back','ended')),
 reason text,
 decided_by uuid references public.people(id) on delete set null,
 decided_at timestamptz,
 foreign key (company_id,card_id) references public.work_cards(company_id,id) on delete cascade,
 check ((decision is null) = (decided_at is null)),
 check (decision is distinct from 'sent_back' or btrim(coalesce(reason,''))<>'')
);
create unique index work_reviews_one_open on public.work_reviews(card_id) where decision is null;
create index work_reviews_card on public.work_reviews(company_id,card_id,asked_at desc);
alter table public.work_reviews enable row level security;
revoke all on public.work_reviews from anon,authenticated;
grant select on public.work_reviews to authenticated;
create policy work_read on public.work_reviews for select to authenticated using (public.is_member(company_id));
create policy card_agent_visible on public.work_reviews as restrictive for select to authenticated using (public.can_see_card(company_id,card_id));

-- 2. When a Card was approved and on which Version (none when it had none): the approved symbol shows while that is
-- still the Card's latest Version.
alter table public.work_cards add column approved_version bigint references public.work_versions(id) on delete set null;
alter table public.work_cards add column approved_at timestamptz;

-- The Card's latest Version, the one a review is asked on.
create function public.card_latest_version(c uuid, card bigint)
returns bigint language sql stable set search_path='' as $$
 select v.id from public.work_versions v where v.company_id=c and v.card_id=card order by v.created_at desc, v.id desc limit 1;
$$;
revoke all on function public.card_latest_version(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.card_latest_version(uuid,bigint) to authenticated;

-- 3. Ask for a review of the Card's latest Version (of the Card as it is, when it has none yet): anyone who may edit the
-- Company's work, on a current Card they see that is not already in review. The Card goes to "Waiting on you", and an
-- earlier approval is no longer the Card's.
create function public.ask_review(c uuid, card bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare w public.work_cards; version bigint; made bigint; begin
 if not public.work_can_edit(c) then raise exception 'not permitted' using errcode='42501'; end if;
 select * into w from public.work_cards x where x.company_id=c and x.id=card for update;
 if not found or w.archived_at is not null or not public.can_see_card(c,card) then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 if exists(select 1 from public.work_reviews r where r.card_id=card and r.decision is null) then raise exception 'already in review' using errcode='P0001'; end if;
 version=public.card_latest_version(c,card);
 insert into public.work_reviews(company_id,card_id,version_id,asked_by) values(c,card,version,auth.uid()) returning id into made;
 perform set_config('approval.internal','yes',true); perform set_config('work.move','yes',true);
 update public.work_cards x set status='waiting', review_submitter=auth.uid(), review_entered_at=now(), rejection_reason=null, approved_version=null, approved_at=null where x.company_id=c and x.id=card;
 perform set_config('approval.internal','',true); perform set_config('work.move','',true);
 insert into public.work_activity(company_id,card_id,actor_id,action,details) values(c,card,auth.uid(),'review_asked',jsonb_build_object('version',version));
 return made;
end $$;
revoke all on function public.ask_review(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.ask_review(uuid,bigint) to authenticated;

-- 4. The decision: an Owner or a Manager who sees the Card, on the Version the review was asked on. The first answer
-- closes the review; a second finds it closed. Approved: Planned with the approved Version when the publishing date is
-- ahead, else Done. Sent back: In progress, the reason a comment the team reads.
create function public.decide_review(c uuid, card bigint, version bigint, decision text, reason text default null)
returns text language plpgsql security definer set search_path='' as $$
declare w public.work_cards; r public.work_reviews; target text; begin
 if not public.can_manage_company(c) then raise exception 'not permitted' using errcode='42501'; end if;
 if decision not in ('approve','send_back') then raise exception 'invalid decision' using errcode='22023'; end if;
 if decision='send_back' and btrim(coalesce(reason,''))='' then raise exception 'reason required' using errcode='22023'; end if;
 select * into w from public.work_cards x where x.company_id=c and x.id=card for update;
 if not found or w.archived_at is not null or not public.can_see_card(c,card) then raise exception 'card not found or not permitted' using errcode='P0002'; end if;
 select * into r from public.work_reviews x where x.company_id=c and x.card_id=card and x.decision is null;
 if not found then raise exception 'review closed' using errcode='P0001'; end if;
 if r.version_id is distinct from version then raise exception 'version changed' using errcode='P0001'; end if;
 update public.work_reviews x set decision=case when decide_review.decision='approve' then 'approved' else 'sent_back' end,
  reason=nullif(btrim(coalesce(decide_review.reason,'')),''), decided_by=auth.uid(), decided_at=now() where x.id=r.id;
 target=case when decide_review.decision='send_back' then 'progress' when w.go_live is not null and w.go_live>now() then 'planned' else 'done' end;
 insert into public.work_activity(company_id,card_id,actor_id,action,details) values(c,card,auth.uid(),
  case when decide_review.decision='approve' then 'approval_approved' else 'approval_rejected' end,
  jsonb_build_object('version',version,'reason',nullif(btrim(coalesce(decide_review.reason,'')),'')));
 perform set_config('approval.internal','yes',true); perform set_config('work.move','yes',true);
 update public.work_cards x set status=target, approval_step_id=null, next_actor=null,
  approved_version=case when decide_review.decision='approve' then version end, approved_at=case when decide_review.decision='approve' then now() end,
  rejection_reason=case when decide_review.decision='send_back' then btrim(decide_review.reason) end
  where x.company_id=c and x.id=card;
 perform set_config('approval.internal','',true); perform set_config('work.move','',true);
 if decide_review.decision='send_back' then
  insert into public.work_comments(company_id,card_id,body,author_id) values(c,card,btrim(decide_review.reason),auth.uid());
 end if;
 return target;
end $$;
revoke all on function public.decide_review(uuid,bigint,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.decide_review(uuid,bigint,bigint,text,text) to authenticated;

-- 5. Archiving a Card ends its open review unanswered. The previous release still enters review through an approval step
-- and decides it with decide_approval until the cutover: a Card it puts on a step is in review here on its latest
-- Version, and a step it closes closes that review, as approved unless the Card went back to work.
create function public.review_from_steps()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.archived_at is not null and old.archived_at is null then
  update public.work_reviews r set decision='ended', decided_by=auth.uid(), decided_at=now() where r.card_id=new.id and r.decision is null;
 elsif new.archived_at is null and new.approval_step_id is not null and (tg_op='INSERT' or old.approval_step_id is null)
  and not exists(select 1 from public.work_reviews r where r.card_id=new.id and r.decision is null) then
  insert into public.work_reviews(company_id,card_id,version_id,asked_by) values(new.company_id,new.id,public.card_latest_version(new.company_id,new.id),coalesce(new.review_submitter,auth.uid()));
 elsif tg_op='UPDATE' and old.approval_step_id is not null and new.approval_step_id is null and new.status<>'waiting' then
  update public.work_reviews r set decision=case when new.status='progress' then 'sent_back' else 'approved' end,
   reason=case when new.status='progress' then coalesce(nullif(btrim(new.rejection_reason),''),'-') end, decided_by=auth.uid(), decided_at=now()
   where r.card_id=new.id and r.decision is null;
 end if;
 return null;
end $$;
revoke all on function public.review_from_steps() from public,anon,authenticated,service_role;
-- On any write: the step is set by approval_card_guard, never named by the write itself.
create trigger work_cards_review_from_steps after insert or update on public.work_cards for each row execute function public.review_from_steps();

-- 6. A Card already waiting on an approval step is in review now, for every Owner and Manager who sees it.
insert into public.work_reviews(company_id,card_id,version_id,asked_by,asked_at)
 select w.company_id, w.id, (select v.id from public.work_versions v where v.company_id=w.company_id and v.card_id=w.id order by v.created_at desc, v.id desc limit 1),
  w.review_submitter, coalesce(w.review_entered_at,w.created_at)
 from public.work_cards w
 where w.approval_step_id is not null and w.status='waiting'
  and not exists(select 1 from public.work_reviews r where r.card_id=w.id and r.decision is null);

-- 7. "Waiting on you" lists every open review for each Owner and Manager who sees its Card (waiting_list runs as the
-- caller, so a Card hidden from them or archived is left out), named by who asked; the rest is as it was.
CREATE OR REPLACE FUNCTION public.waiting_list(c uuid)
 RETURNS TABLE(kind text, id bigint, title text, body text, asked_by text, card_id bigint, conversation_id uuid, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select * from (
  select 'approval'::text, w.id, w.title, ''::text, coalesce(p.name,''), w.id, null::uuid, r.asked_at
   from public.work_reviews r
   join public.work_cards w on w.company_id=r.company_id and w.id=r.card_id
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and r.decision is null and public.can_manage_company(c)
  union all
  select i.kind, i.id, i.title, i.body, i.asked_by, i.card_id, i.conversation_id, i.created_at
   from public.waiting_items i where i.company_id=c and i.person_id=auth.uid() and i.resolved_at is null
  union all
  select 'agent_request'::text, r.id, r.agent_name, r.job, coalesce(p.name,''), null::bigint, null::uuid, r.created_at
   from public.lead_agent_requests r
   join public.members m on m.company_id=r.company_id and m.person_id=r.asked_by and m.removed_at is null
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and r.state='waiting' and public.is_company_owner(c)
  union all
  select r.kind, r.id, case r.kind when 'question' then r.content->>'question' else r.title end, ''::text, v.agent_name,
    (select w.id from public.work_cards w where w.company_id=c and w.conversation_id=r.conversation_id), r.conversation_id, r.created_at
   from public.reply_cards r
   join public.conversations v on v.id=r.conversation_id and v.company_id=r.company_id
   where r.company_id=c and r.kind in ('question','hand','permission') and v.person_id=auth.uid() and public.reply_card_waits(r)
  union all
  select 'channel_permission'::text, p.id, p.title, ''::text, r.agent_name, null::bigint, null::uuid, p.created_at
   from public.channel_permissions p
   join public.channel_runs r on r.message_id=p.message_id and r.ordinal=p.ordinal
   where p.company_id=c and p.state='open' and public.channel_permission_waits(p)
  union all
  select 'channel_question'::text, r.id, r.content->>'question', ''::text, cr.agent_name, null::bigint, null::uuid, r.created_at
   from public.reply_cards r
   join public.channel_messages m on m.id=r.channel_message_id
   join public.channel_runs cr on cr.message_id=r.channel_message_id and cr.ordinal=coalesce(r.channel_ordinal,1)
   where r.company_id=c and r.kind='question' and r.state='open' and cr.outcome is null
    and public.conversation_can_write(c) and public.in_channel(m.channel_id)
    and (r.addressed_to is null or r.addressed_to=auth.uid())
  union all
  select 'channel_hand'::text, r.id, r.title, ''::text, cr.agent_name, null::bigint, null::uuid, r.created_at
   from public.reply_cards r
   join public.channel_messages m on m.id=r.channel_message_id
   join public.channel_runs cr on cr.message_id=r.channel_message_id and cr.ordinal=coalesce(r.channel_ordinal,1)
   where r.company_id=c and r.kind='hand' and r.state='open'
    and public.conversation_can_write(c) and public.in_channel(m.channel_id)
  union all
  select 'agent_key'::text, k.id, g.name, ''::text, ''::text, null::bigint, null::uuid, k.created_at
   from public.agent_key_waits k
   join public.hermes_agents g on g.company_id=k.company_id and g.id=k.agent_id
   where k.company_id=c and public.agent_key_waits_shown(c)
  union all
  select 'agent_change'::text, p.id, g.name, p.change, b.name, null::bigint, null::uuid, p.created_at
   from public.agent_change_proposals p
   join public.hermes_agents g on g.company_id=p.company_id and g.id=p.agent_id
   join public.hermes_agents b on b.company_id=p.company_id and b.id=p.proposed_by
   where p.company_id=c and p.state in ('waiting','applying') and public.is_company_owner(c)
  union all
  select 'agent_access'::text, r.id, g.name, g.speciality, coalesce(p.name,''), null::bigint, null::uuid, r.pressed_at
   from public.agent_access_requests r
   join public.hermes_agents g on g.company_id=r.company_id and g.id=r.agent_id
   join public.members m on m.company_id=r.company_id and m.person_id=r.asked_by and m.removed_at is null
   left join public.people p on p.id=r.asked_by
   where r.company_id=c and public.agent_access_waits(r)
 ) x(kind,id,title,body,asked_by,card_id,conversation_id,created_at)
 order by created_at desc, id desc;
$function$;
