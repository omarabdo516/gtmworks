-- Lessons: what an agent learned on a card, proposed as one addition to one of its skills. Nothing reaches the skill until a person approves it (ADR 0006).
-- The proposal keeps its reason, the card it came from and the skill version it was written against; a decision keeps who made it and when.
create table public.skill_lessons (
 id bigint generated always as identity primary key, company_id uuid not null references public.companies(id),
 skill_id uuid not null, card_id bigint not null, proposed_by uuid not null references public.agents(id),
 lesson text not null check (char_length(lesson) between 1 and 500), reason text not null check (char_length(reason) between 1 and 1000),
 base_version integer not null, request_key text not null check (char_length(request_key) between 1 and 200), fingerprint text not null,
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 decided_by uuid references public.people(id), decided_at timestamptz, result_version integer, created_at timestamptz not null default now(),
 check ((status='pending')=(decided_by is null)), check ((status='approved')=(result_version is not null)),
 unique (company_id, proposed_by, request_key),
 foreign key (company_id, skill_id) references public.skills(company_id, id), foreign key (company_id, card_id) references public.work_cards(company_id, id)
);
alter table public.skill_lessons enable row level security;
create policy skill_lessons_read on public.skill_lessons for select to authenticated using (public.is_member(company_id) or public.agency_access());
-- Only the functions below change this table; clients get read access only.
revoke all on public.skill_lessons from public, anon, authenticated;
grant select on public.skill_lessons to authenticated;

-- An agent proposes a lesson from a live run, for a skill enabled for it. The card is the run's card, read from the key, never from the request.
-- A lesson is one line of text: line breaks are folded into spaces so it can only ever be one bullet. A repeated request key returns the first proposal.
create function public.propose_skill_lesson(c uuid, k uuid, skill_slug text, req_key text, print text, lesson_text text, why text) returns jsonb language plpgsql security definer set search_path='' as $$
declare sk public.skills%rowtype; run_card_id bigint; existing public.skill_lessons%rowtype; one_line text := btrim(regexp_replace(coalesce(lesson_text,''), '\s+', ' ', 'g')); reason_line text := btrim(regexp_replace(coalesce(why,''), '\s+', ' ', 'g')); latest integer; created bigint;
begin
 select card_id into run_card_id from public.agent_keys where id=k and company_id=c and person_id=auth.uid() and kind='run' and card_id is not distinct from (auth.jwt()->>'run_card')::bigint and revoked_at is null and expires_at>now();
 if run_card_id is null or not exists(select 1 from public.members m where m.company_id=c and m.person_id=auth.uid() and m.removed_at is null and m.role='contributor')
  or not exists(select 1 from public.agent_grants g where g.company_id=c and g.agent_id=auth.uid() and g.revoked_at is null) then raise exception 'not permitted' using errcode='42501'; end if;
 if length(req_key)<1 or length(req_key)>200 then raise exception 'invalid idempotency key'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text || auth.uid()::text || req_key,0));
 select * into existing from public.skill_lessons x where x.company_id=c and x.proposed_by=auth.uid() and x.request_key=req_key;
 if found then if existing.fingerprint<>print then raise exception 'idempotency key reused'; end if; return jsonb_build_object('id',existing.id,'status',existing.status); end if;
 select s.* into sk from public.skills s join public.skill_enablements e on e.skill_id=s.id and e.agent_id=auth.uid() where s.company_id=c and s.slug=skill_slug;
 if not found then raise exception 'skill not found'; end if;
 if one_line='' or length(one_line)>500 or reason_line='' or length(reason_line)>1000 then raise exception 'invalid lesson' using errcode='22023'; end if;
 if (select count(*) from public.skill_lessons x where x.skill_id=sk.id and x.proposed_by=auth.uid() and x.status='pending')>=10 then raise exception 'too many pending lessons' using errcode='22023'; end if;
 select max(version) into latest from public.skill_versions where skill_id=sk.id;
 insert into public.skill_lessons(company_id,skill_id,card_id,proposed_by,lesson,reason,base_version,request_key,fingerprint) values (c,sk.id,run_card_id,auth.uid(),one_line,reason_line,latest,req_key,print) returning id into created;
 return jsonb_build_object('id',created,'status','pending');
end $$;

-- A person who manages the company decides on one lesson. Approving adds it as the last bullet of the skill's Lessons section (made when the skill has none) and stores that as the skill's next version.
-- Rejecting stores nothing in the skill. A lesson is decided once; an agent never decides.
create function public.decide_skill_lesson(c uuid, l bigint, approve boolean) returns integer language plpgsql security definer set search_path='' as $$
declare ls public.skill_lessons%rowtype; latest public.skill_versions%rowtype; body text; next_version integer;
begin
 if auth.uid() is null or exists(select 1 from public.agents where id=auth.uid()) or not public.can_manage_company(c) then raise exception 'not permitted' using errcode='42501'; end if;
 select * into ls from public.skill_lessons where company_id=c and id=l for update;
 if not found then raise exception 'lesson not found'; end if;
 if ls.status<>'pending' then raise exception 'lesson already decided' using errcode='22023'; end if;
 if not approve then
  update public.skill_lessons set status='rejected', decided_by=auth.uid(), decided_at=now() where id=ls.id;
  return null;
 end if;
 perform 1 from public.skills where id=ls.skill_id for update;
 select * into latest from public.skill_versions where skill_id=ls.skill_id order by version desc limit 1;
 body := rtrim(latest.content, E'\n\r ') || case when latest.content ~ E'(^|\n)## Lessons[ \t]*(\r?\n|$)' then E'\n' else E'\n\n## Lessons\n\n' end || '- ' || ls.lesson || E'\n';
 if octet_length(body)>20000 then raise exception 'skill too large' using errcode='22023'; end if;
 next_version := latest.version+1;
 insert into public.skill_versions(company_id,skill_id,version,name,description,permissions,content,sha256,created_by)
  values (c,ls.skill_id,next_version,latest.name,latest.description,latest.permissions,body,encode(sha256(convert_to(body,'UTF8')),'hex'),auth.uid());
 update public.skill_lessons set status='approved', decided_by=auth.uid(), decided_at=now(), result_version=next_version where id=ls.id;
 return next_version;
end $$;
revoke all on function public.propose_skill_lesson(uuid,uuid,text,text,text,text,text) from public, anon;
revoke all on function public.decide_skill_lesson(uuid,bigint,boolean) from public, anon;
grant execute on function public.propose_skill_lesson(uuid,uuid,text,text,text,text,text) to authenticated;
grant execute on function public.decide_skill_lesson(uuid,bigint,boolean) to authenticated;
