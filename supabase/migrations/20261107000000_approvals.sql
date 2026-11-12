-- Stable workflow identities survive changes to a stage's display name or order.
alter table public.work_stages add column stage_key text check (stage_key is null or stage_key in ('writing','design','approved','scheduled'));
with originals as (select id, row_number() over (partition by company_id order by id) as ordinal from public.work_stages) update public.work_stages s set stage_key=case o.ordinal when 3 then 'writing' when 4 then 'design' when 6 then 'approved' when 7 then 'scheduled' end from originals o where s.id=o.id and o.ordinal in (3,4,6,7);
create unique index work_stages_company_stage_key on public.work_stages(company_id,stage_key) where stage_key is not null;
create function public.work_stage_key_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='INSERT' then
  new.stage_key=case new.name when 'كتابة' then 'writing' when 'تصميم ومونتاج' then 'design' when 'معتمد' then 'approved' when 'مجدول للنشر' then 'scheduled' else null end;
 elsif new.stage_key is distinct from old.stage_key then raise exception 'stage identity cannot change'; end if;
 return new; end $$;
create trigger work_stage_key_guard before insert or update on public.work_stages for each row execute function public.work_stage_key_guard();
create function public.required_work_stage(c uuid, required_key text) returns bigint language plpgsql stable security definer set search_path='' as $$ declare result bigint; begin
 select id into result from public.work_stages where company_id=c and stage_key=required_key;
 if result is null then raise exception 'required work stage missing: %', required_key; end if;
 return result; end $$;
create table public.approval_steps (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 name text not null check (length(trim(name))>0), position integer not null,
 person_id uuid, role public.member_role, removed_at timestamptz,
 unique(company_id,id), foreign key(company_id,person_id) references public.members(company_id,person_id),
 check ((person_id is null) <> (role is null)), check (role is null or role in ('owner','manager','reviewer'))
);
alter table public.approval_steps enable row level security;
create policy approval_steps_read on public.approval_steps for select to authenticated using (public.is_member(company_id) or public.agency_access());
alter table public.work_cards add column approval_step_id bigint, add column review_submitter uuid, add column rejection_reason text, add column review_entered_at timestamptz;
alter table public.work_cards add foreign key (company_id,approval_step_id) references public.approval_steps(company_id,id);
create function public.approval_defaults() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.approval_steps(company_id,name,position,role) values(new.id,'مراجعة',1,'owner'); return new; end $$;
create trigger company_approval_defaults after insert on public.companies for each row execute function public.approval_defaults();
insert into public.approval_steps(company_id,name,position,role) select id,'مراجعة',1,'owner' from public.companies;
create function public.approval_actor(c uuid, step bigint) returns uuid language sql stable security definer set search_path='' as $$
 select m.person_id from public.approval_steps s join public.members m on m.company_id=s.company_id and m.removed_at is null and m.role in ('owner','manager','reviewer') and (m.person_id=s.person_id or (s.person_id is null and m.role=s.role)) where s.company_id=c and s.id=step and s.removed_at is null order by m.person_id limit 1 $$;
-- Bring cards already in review into the first step, preserving the last recorded submitter.
create function public.backfill_review_approvals() returns void language sql set search_path='' as $$
 update public.work_cards w set
  approval_step_id=(select s.id from public.approval_steps s where s.company_id=w.company_id and s.removed_at is null order by s.position,s.id limit 1),
  review_submitter=(select a.actor_id from public.work_activity a where a.company_id=w.company_id and a.card_id=w.id and ((a.action='card_changed' and a.details->>'field'='stage_id' and a.details->>'new'=w.stage_id::text) or (a.action='card_created' and a.details->>'stage_id'=w.stage_id::text)) order by a.id desc limit 1),
  review_entered_at=coalesce((select a.created_at from public.work_activity a where a.company_id=w.company_id and a.card_id=w.id and ((a.action='card_changed' and a.details->>'field'='stage_id' and a.details->>'new'=w.stage_id::text) or (a.action='card_created' and a.details->>'stage_id'=w.stage_id::text)) order by a.id desc limit 1),w.created_at),
  next_actor=public.approval_actor(w.company_id,(select s.id from public.approval_steps s where s.company_id=w.company_id and s.removed_at is null order by s.position,s.id limit 1))
 where w.approval_step_id is null and exists(select 1 from public.work_stages st where st.company_id=w.company_id and st.id=w.stage_id and st.kind='review');
$$;
revoke all on function public.backfill_review_approvals() from public, anon, authenticated;
select public.backfill_review_approvals();
create function public.approval_holds(c uuid, step bigint) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.approval_steps s join public.members m on m.company_id=s.company_id and m.person_id=auth.uid() and m.removed_at is null and m.role in ('owner','manager','reviewer') and (m.person_id=s.person_id or (s.person_id is null and m.role=s.role)) where s.company_id=c and s.id=step and s.removed_at is null) $$;
create function public.approval_card_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare oldkind text; newkind text; firststep bigint; begin
 select kind into newkind from public.work_stages where company_id=new.company_id and id=new.stage_id;
 if tg_op='UPDATE' then select kind into oldkind from public.work_stages where company_id=old.company_id and id=old.stage_id; end if;
 if current_setting('approval.internal',true) is distinct from 'yes' then
  if tg_op='INSERT' and (new.approval_step_id is not null or new.review_submitter is not null or new.rejection_reason is not null or new.review_entered_at is not null) then raise exception 'approval fields are protected'; end if;
  if tg_op='UPDATE' and (new.approval_step_id is distinct from old.approval_step_id or new.review_submitter is distinct from old.review_submitter or new.rejection_reason is distinct from old.rejection_reason or new.review_entered_at is distinct from old.review_entered_at) then raise exception 'approval fields are protected'; end if;
  if tg_op='UPDATE' and oldkind='review' and new.next_actor is distinct from old.next_actor then raise exception 'current approver controls next actor'; end if;
  if newkind='after_review' and (tg_op='INSERT' or oldkind is distinct from newkind) then if not public.can_manage_company(new.company_id) then raise exception 'contributors cannot move beyond review'; end if; raise exception 'approval required'; end if;
  if newkind='review' and (tg_op='INSERT' or oldkind is distinct from 'review') then
   select id into firststep from public.approval_steps where company_id=new.company_id and removed_at is null order by position,id limit 1;
   if firststep is null then raise exception 'approval step required'; end if;
   new.approval_step_id=firststep; new.review_submitter=auth.uid(); new.review_entered_at=now(); new.rejection_reason=null; new.next_actor=public.approval_actor(new.company_id,firststep);
  elsif tg_op='UPDATE' and oldkind='review' and newkind<>'review' then raise exception 'decision required'; end if;
 end if;
 return new; end $$;
create trigger approval_card_guard before insert or update on public.work_cards for each row execute function public.approval_card_guard();
create function public.decide_approval(c uuid, card bigint, decision text, reason text default null, caption_marked boolean default false, design_marked boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare w public.work_cards%rowtype; s public.approval_steps%rowtype; nxt bigint; target bigint; begin
 select * into w from public.work_cards where company_id=c and id=card for update;
 if not found or not public.approval_holds(c,w.approval_step_id) or not exists(select 1 from public.work_stages where company_id=c and id=w.stage_id and kind='review') then raise exception 'not current approver'; end if;
 select * into s from public.approval_steps where company_id=c and id=w.approval_step_id;
 if decision not in ('approve','reject') then raise exception 'invalid decision'; end if;
 if decision='reject' and (nullif(trim(reason),'') is null or not (caption_marked or design_marked)) then raise exception 'reason and marked part required'; end if;
 insert into public.work_activity(company_id,card_id,actor_id,action,details) values(c,card,auth.uid(),case when decision='approve' then 'approval_approved' else 'approval_rejected' end,jsonb_build_object('step',s.name,'step_id',s.id,'reason',reason,'caption',caption_marked,'design',design_marked));
 perform set_config('approval.internal','yes',true);
 if decision='reject' then
  target=public.required_work_stage(c,case when caption_marked then 'writing' else 'design' end);
  update public.work_cards set stage_id=target,approval_step_id=null,next_actor=w.review_submitter,rejection_reason=trim(reason) where company_id=c and id=card;
 else
  select id into nxt from public.approval_steps where company_id=c and removed_at is null and (position,id)>(s.position,s.id) order by position,id limit 1;
  if nxt is not null then update public.work_cards set approval_step_id=nxt,next_actor=public.approval_actor(c,nxt) where company_id=c and id=card;
  else
   target=public.required_work_stage(c,'approved');
   update public.work_cards set stage_id=target,approval_step_id=null,next_actor=null where company_id=c and id=card;
   if w.go_live is not null then target=public.required_work_stage(c,'scheduled'); update public.work_cards set stage_id=target where company_id=c and id=card; end if;
  end if;
 end if;
 perform set_config('approval.internal','',true);
end $$;
create function public.save_approval_step(c uuid, step bigint, step_name text, step_position integer, member uuid, member_role public.member_role) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.can_manage_company(c) then raise exception 'not permitted'; end if;
 if member is not null and not exists(select 1 from public.members where company_id=c and person_id=member and removed_at is null and role in ('owner','manager','reviewer')) then raise exception 'invalid approver'; end if;
 if step is null then insert into public.approval_steps(company_id,name,position,person_id,role) values(c,step_name,step_position,member,member_role);
 else update public.approval_steps set name=step_name,position=step_position,person_id=member,role=member_role where company_id=c and id=step and removed_at is null; if not found then raise exception 'step not found'; end if; perform set_config('approval.internal','yes',true); update public.work_cards set next_actor=public.approval_actor(c,step) where company_id=c and approval_step_id=step; perform set_config('approval.internal','',true); end if;
end $$;
create function public.remove_approval_step(c uuid, step bigint) returns void language plpgsql security definer set search_path='' as $$
declare s public.approval_steps%rowtype; nxt bigint; w record; target bigint; begin
 if not public.can_manage_company(c) then raise exception 'not permitted'; end if;
 select * into s from public.approval_steps where company_id=c and id=step and removed_at is null for update; if not found then raise exception 'step not found'; end if;
 if (select count(*) from public.approval_steps where company_id=c and removed_at is null)<2 then raise exception 'one step required'; end if;
 select id into nxt from public.approval_steps where company_id=c and removed_at is null and (position,id)>(s.position,s.id) order by position,id limit 1;
 perform set_config('approval.internal','yes',true);
 for w in select * from public.work_cards where company_id=c and approval_step_id=step for update loop
  insert into public.work_activity(company_id,card_id,actor_id,action,details) values(c,w.id,auth.uid(),'approval_skipped',jsonb_build_object('step',s.name,'step_id',s.id));
  if nxt is not null then update public.work_cards set approval_step_id=nxt,next_actor=public.approval_actor(c,nxt) where id=w.id;
  else target=public.required_work_stage(c,'approved'); update public.work_cards set approval_step_id=null,next_actor=null,stage_id=target where id=w.id; if w.go_live is not null then target=public.required_work_stage(c,'scheduled'); update public.work_cards set stage_id=target where id=w.id; end if; end if;
 end loop;
 update public.approval_steps set removed_at=now() where company_id=c and id=step;
 perform set_config('approval.internal','',true);
end $$;
create or replace function public.work_guard() returns trigger language plpgsql security definer set search_path='' as $$ declare stage_kind text; previous_kind text; begin
 if tg_op='UPDATE' and new.company_id<>old.company_id then raise exception 'company cannot change'; end if;
 if current_setting('approval.internal',true) is distinct from 'yes' and (tg_op='INSERT' or new.stage_id<>old.stage_id) and auth.uid() is not null and not public.can_manage_company(new.company_id) then
 select kind into stage_kind from public.work_stages where id=new.stage_id and company_id=new.company_id;
 if tg_op='UPDATE' then select kind into previous_kind from public.work_stages where id=old.stage_id and company_id=old.company_id; end if;
 if stage_kind='after_review' or previous_kind='after_review' then raise exception 'contributors cannot move beyond review'; end if; end if; return new; end $$;
create function public.schedule_approved_card() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.go_live is not null and old.go_live is null and exists(select 1 from public.work_stages where company_id=new.company_id and id=new.stage_id and stage_key='approved') then
  perform set_config('approval.internal','yes',true); update public.work_cards set stage_id=public.required_work_stage(new.company_id,'scheduled') where id=new.id; perform set_config('approval.internal','',true);
 end if; return new; end $$;
create trigger schedule_approved_card after update of go_live on public.work_cards for each row execute function public.schedule_approved_card();
