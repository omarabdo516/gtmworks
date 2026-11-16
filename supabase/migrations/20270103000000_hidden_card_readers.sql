-- A Card tied to a chat stays hidden from a Member the chat's Agent is hidden from in the functions that read Cards as
-- their owner, and so skip the read rules #221 (#144) put on the Card, its rows and its files (#228). Each answers for
-- such a Card as for a Card that does not exist, through #221's own rule: can_see_card for the signed-in caller,
-- agent_visible_to for a person the function names. Nothing changes for a caller who sees the Agent.
-- supabase/tests/card_readers_guard.sql lists every function that reads Cards that way, with why it checks or need not.
-- Only replaces functions, each keeping its arguments, result, security, search path and grants: the previous app
-- version calls them as before.

create or replace function public.issue_run_key_for(c uuid, card bigint, agent uuid, hash text, ttl_seconds integer) returns timestamptz language plpgsql security definer set search_path='' as $$
declare until_at timestamptz; begin
 if agent is null or not exists(select 1 from public.members m where m.company_id=c and m.person_id=agent and m.role='contributor' and m.removed_at is null) then raise exception 'not permitted'; end if;
 -- Authority fails closed: the agent must still hold a live company key, so a delivery retried after an Owner revoked the key issues nothing.
 if not exists(select 1 from public.agent_keys k where k.company_id=c and k.person_id=agent and k.kind='agent' and k.revoked_at is null) then raise exception 'not permitted'; end if;
 if ttl_seconds is null or ttl_seconds<1 or ttl_seconds>86400 or hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid run key request' using errcode='22023'; end if;
 if not exists(select 1 from public.work_cards w where w.company_id=c and w.id=card
  and public.agent_visible_to(c,agent,(select v.agent_id from public.conversations v where v.id=w.conversation_id and v.company_id=w.company_id))) then raise exception 'card not found'; end if;
 if not exists(select 1 from public.work_cards w where w.company_id=c and w.id=card and w.next_actor=agent) and not exists(select 1 from public.work_assignees a where a.company_id=c and a.card_id=card and a.person_id=agent) then raise exception 'not permitted'; end if;
 insert into public.agent_keys(company_id,person_id,key_hash,kind,card_id,expires_at) values (c,agent,hash,'run',card,now()+make_interval(secs=>ttl_seconds)) returning expires_at into until_at;
 return until_at;
end $$;

-- A run key resolves only while its person sees its Card; otherwise it is as unknown as a key whose Card is gone (401).
create or replace function public.lookup_agent_key(hash text) returns table(key_id uuid, company_id uuid, person_id uuid, slug text, key_hash text, kind text, card_id bigint) language plpgsql security definer set search_path='' as $$
begin
 return query update public.agent_keys k set last_used_at=now() from public.members m, public.companies c where k.key_hash=hash and k.revoked_at is null and (k.expires_at is null or k.expires_at>now()) and m.company_id=k.company_id and m.person_id=k.person_id and m.removed_at is null and m.role='contributor' and c.id=k.company_id and (not exists(select 1 from public.agents a where a.id=k.person_id) or exists(select 1 from public.agent_grants g where g.company_id=k.company_id and g.agent_id=k.person_id and g.revoked_at is null))
  and (k.card_id is null or public.agent_visible_to(k.company_id,k.person_id,(select v.agent_id from public.work_cards w join public.conversations v on v.id=w.conversation_id and v.company_id=w.company_id where w.company_id=k.company_id and w.id=k.card_id))) returning k.id,k.company_id,k.person_id,c.slug,k.key_hash,k.kind,k.card_id;
end $$;

create or replace function public.agent_write(c uuid, request_key text, fingerprint text, op text, card bigint, payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.agent_requests%rowtype; result jsonb; created bigint; ev text := payload->>'evidence'; begin
 if length(request_key)<1 or length(request_key)>200 then raise exception 'invalid idempotency key'; end if;
 -- A run key reaches its one card in the database as well as in the route.
 if auth.jwt()->>'run_card' is not null and card is distinct from (auth.jwt()->>'run_card')::bigint then raise exception 'not permitted'; end if;
 -- A row added to such a Card is refused by its read rule, where one added to a missing Card fails the foreign key. As
 -- id 0, which no Card has, it gets every answer a missing Card gets.
 if card is not null and not public.can_see_card(c,card) then card:=0; end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text || auth.uid()::text || request_key,0));
 select * into existing from public.agent_requests r where r.company_id=c and r.person_id=auth.uid() and r.request_key=agent_write.request_key;
 if found then if existing.fingerprint<>fingerprint then raise exception 'idempotency key reused'; end if; return existing.result; end if;
 case op
 when 'create' then
  if payload ? 'message' then created=public.create_card_request(c,payload->>'message',(payload->>'agent')::uuid,payload->>'mode');
  else created=public.create_work_card(c,(payload->>'stage')::bigint,payload->>'title',coalesce(payload->>'template',''),ev); end if;
  result=jsonb_build_object('id',created);
 when 'move' then perform public.move_work_card(c,card,(payload->>'stage')::bigint,ev); result='{}'::jsonb;
 when 'edit' then perform public.edit_work_card(c,card,payload->'fields',ev); result='{}'::jsonb;
 else
  if op in ('actor','assignee','label','check','comment','version','creative_with_version') then created=public.change_work_card(c,card,op,payload,ev); result=jsonb_build_object('id',created);
  else raise exception 'operation forbidden'; end if;
 end case;
 insert into public.agent_requests(company_id,person_id,request_key,fingerprint,result) values(c,auth.uid(),request_key,fingerprint,result);
 return result;
end $$;

-- The keys still end; the count is a missing Card's, which holds none.
create or replace function public.revoke_run_keys(c uuid, card bigint, run_key_id uuid) returns integer language plpgsql security definer set search_path='' as $$
declare revoked_count integer; begin
 if auth.uid() is null then raise exception 'not permitted'; end if;
 update public.agent_keys set revoked_at=now() where company_id=c and card_id=card and person_id=auth.uid() and kind='run' and revoked_at is null and (run_key_id is null or id=run_key_id);
 get diagnostics revoked_count = row_count; return case when public.can_see_card(c,card) then revoked_count else 0 end;
end $$;

create or replace function public.enqueue_assignment_webhook() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; assigned_card_id bigint; company_slug text; company_name text; begin
 if tg_table_name='work_assignees' then target=new.person_id; assigned_card_id=new.card_id; else target=new.next_actor; assigned_card_id=new.id; end if;
 if target is null or not exists(select 1 from public.agent_keys k where k.company_id=new.company_id and k.person_id=target and k.kind='agent' and k.revoked_at is null) then return new; end if;
 if not public.agent_visible_to(new.company_id,target,(select v.agent_id from public.work_cards w join public.conversations v on v.id=w.conversation_id and v.company_id=w.company_id
  where w.company_id=new.company_id and w.id=assigned_card_id)) then return new; end if;
 if not exists(select 1 from public.agent_webhooks where company_id=new.company_id) then return new; end if;
 select slug,name into company_slug,company_name from public.companies where id=new.company_id;
 insert into public.webhook_deliveries(company_id,card_id,event) values(new.company_id,assigned_card_id,jsonb_build_object('company',jsonb_build_object('id',new.company_id,'slug',company_slug,'name',company_name),'card',assigned_card_id,'event_type','assigned','agent',jsonb_build_object('id',target,'name',(select name from public.people where id=target)),'card_path','/c/'||company_slug||'/work/board/'||assigned_card_id));
 return new;
end $$;

create or replace function public.propose_skill_lesson(c uuid, k uuid, skill_slug text, req_key text, print text, lesson_text text, why text) returns jsonb language plpgsql security definer set search_path='' as $$
declare sk public.skills%rowtype; run_card_id bigint; existing public.skill_lessons%rowtype; one_line text := btrim(regexp_replace(coalesce(lesson_text,''), '\s+', ' ', 'g')); reason_line text := btrim(regexp_replace(coalesce(why,''), '\s+', ' ', 'g')); latest integer; created bigint;
begin
 select card_id into run_card_id from public.agent_keys where id=k and company_id=c and person_id=auth.uid() and kind='run' and card_id is not distinct from (auth.jwt()->>'run_card')::bigint and revoked_at is null and expires_at>now();
 if run_card_id is null or not exists(select 1 from public.members m where m.company_id=c and m.person_id=auth.uid() and m.removed_at is null and m.role='contributor')
  or not exists(select 1 from public.agent_grants g where g.company_id=c and g.agent_id=auth.uid() and g.revoked_at is null)
  or not public.can_see_card(c,run_card_id) then raise exception 'not permitted' using errcode='42501'; end if;
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

create or replace function public.decide_skill_lesson(c uuid, l bigint, approve boolean) returns integer language plpgsql security definer set search_path='' as $$
declare ls public.skill_lessons%rowtype; latest public.skill_versions%rowtype; body text; next_version integer;
begin
 if auth.uid() is null or exists(select 1 from public.agents where id=auth.uid()) or not public.can_manage_company(c) then raise exception 'not permitted' using errcode='42501'; end if;
 select * into ls from public.skill_lessons where company_id=c and id=l for update;
 if not found or not public.can_see_card(c,ls.card_id) then raise exception 'lesson not found'; end if;
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

create or replace function public.decide_approval(c uuid, card bigint, decision text, reason text default null, caption_marked boolean default false, design_marked boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare w public.work_cards%rowtype; s public.approval_steps%rowtype; nxt bigint; target bigint; begin
 select * into w from public.work_cards where company_id=c and id=card for update;
 if not found or not public.can_see_card(c,card) or not public.approval_holds(c,w.approval_step_id) or not exists(select 1 from public.work_stages where company_id=c and id=w.stage_id and kind='review') then raise exception 'not current approver'; end if;
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

create or replace function public.edit_card_note(c uuid, note bigint, note_body text) returns boolean
language plpgsql security definer set search_path='' as $$
declare changed bigint;
begin
 if not public.work_can_edit(c) then raise exception 'noteNotAllowed' using errcode='42501'; end if;
 if not exists(select 1 from public.work_comments where id=note and company_id=c and public.can_see_card(c,card_id)) then raise exception 'noteNotFound' using errcode='P0002'; end if;
 update public.work_comments set body=btrim(coalesce(note_body,''), E' \t\r\n') where id=note and company_id=c returning id into changed;
 return changed is not null;
end $$;
