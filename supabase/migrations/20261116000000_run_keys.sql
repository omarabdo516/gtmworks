-- A run key is an agent_keys row of kind 'run': it names one card, expires, and ends with the agent's company grant (ADR 0006).
-- Only the SHA-256 hash is stored. Existing keys stay kind 'agent' with no expiry (the legacy transition).
alter table public.agent_keys
 add column kind text not null default 'agent' check (kind in ('agent','run')),
 add column card_id bigint,
 add column expires_at timestamptz,
 add column issued_at timestamptz generated always as (created_at) stored,
 add constraint agent_keys_scope check ((kind='run' and card_id is not null and expires_at is not null) or (kind='agent' and card_id is null and expires_at is null)),
 add constraint agent_keys_card_fk foreign key (company_id, card_id) references public.work_cards(company_id, id) on delete cascade;
-- Owners manage company keys only. Run keys are made by issue_run_key and end with the grant or the clock.
alter policy agent_keys_owner_read on public.agent_keys using (kind='agent' and exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));
alter policy agent_keys_owner_create on public.agent_keys with check (kind='agent' and exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null) and exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=agent_keys.person_id and m.role='contributor' and m.removed_at is null));
alter policy agent_keys_owner_update on public.agent_keys using (kind='agent' and exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null)) with check (kind='agent' and exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));

-- The lookup also returns the stored hash (the server compares it in constant time), the kind and the card.
-- An expired key does not resolve.
drop function public.lookup_agent_key(text);
create function public.lookup_agent_key(hash text) returns table(key_id uuid, company_id uuid, person_id uuid, slug text, key_hash text, kind text, card_id bigint) language plpgsql security definer set search_path='' as $$
begin
 return query update public.agent_keys k set last_used_at=now() from public.members m, public.companies c where k.key_hash=hash and k.revoked_at is null and (k.expires_at is null or k.expires_at>now()) and m.company_id=k.company_id and m.person_id=k.person_id and m.removed_at is null and m.role='contributor' and c.id=k.company_id and (not exists(select 1 from public.agents a where a.id=k.person_id) or exists(select 1 from public.agent_grants g where g.company_id=k.company_id and g.agent_id=k.person_id and g.revoked_at is null)) returning k.id,k.company_id,k.person_id,c.slug,k.key_hash,k.kind,k.card_id;
end $$;
revoke all on function public.lookup_agent_key(text) from public, anon, authenticated;
grant execute on function public.lookup_agent_key(text) to service_role;
-- A run key whose grant is gone is simply invalid (401); only company keys answer 404.
create or replace function public.agent_key_denied(hash text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agent_keys k where k.key_hash=hash and k.kind='agent' and k.revoked_at is null and exists(select 1 from public.agents a where a.id=k.person_id) and not exists(select 1 from public.agent_grants g where g.company_id=k.company_id and g.agent_id=k.person_id and g.revoked_at is null));
$$;

-- Assigning a card to an agent makes the agent eligible for a run key for that card; the secret is minted at delivery, because a key is shown once and stored only as a hash (ADR 0007).
-- With a company webhook, the worker calls this and pushes the key with the signed `assigned` request. Without one, the agent pulls it: issue_run_key below succeeds only for a card currently assigned to the caller.
-- The caller supplies only the hash, so the key is shown once and never stored.
create function public.issue_run_key_for(c uuid, card bigint, agent uuid, hash text, ttl_seconds integer) returns timestamptz language plpgsql security definer set search_path='' as $$
declare until_at timestamptz; begin
 if agent is null or not exists(select 1 from public.members m where m.company_id=c and m.person_id=agent and m.role='contributor' and m.removed_at is null) then raise exception 'not permitted'; end if;
 -- Authority fails closed: the agent must still hold a live company key, so a delivery retried after an Owner revoked the key issues nothing.
 if not exists(select 1 from public.agent_keys k where k.company_id=c and k.person_id=agent and k.kind='agent' and k.revoked_at is null) then raise exception 'not permitted'; end if;
 if ttl_seconds is null or ttl_seconds<1 or ttl_seconds>86400 or hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid run key request' using errcode='22023'; end if;
 if not exists(select 1 from public.work_cards w where w.company_id=c and w.id=card) then raise exception 'card not found'; end if;
 if not exists(select 1 from public.work_cards w where w.company_id=c and w.id=card and w.next_actor=agent) and not exists(select 1 from public.work_assignees a where a.company_id=c and a.card_id=card and a.person_id=agent) then raise exception 'not permitted'; end if;
 insert into public.agent_keys(company_id,person_id,key_hash,kind,card_id,expires_at) values (c,agent,hash,'run',card,now()+make_interval(secs=>ttl_seconds)) returning expires_at into until_at;
 return until_at;
end $$;
revoke all on function public.issue_run_key_for(uuid,bigint,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.issue_run_key_for(uuid,bigint,uuid,text,integer) to service_role;
create function public.issue_run_key(c uuid, card bigint, hash text, ttl_seconds integer) returns timestamptz language sql security definer set search_path='' as $$
 select public.issue_run_key_for(c,card,auth.uid(),hash,ttl_seconds);
$$;
revoke all on function public.issue_run_key(uuid,bigint,text,integer) from public, anon;
grant execute on function public.issue_run_key(uuid,bigint,text,integer) to authenticated;

-- Assigning a card (next actor or assignee) to an agent that holds a company key queues an `assigned` webhook when the company has one; the worker adds the run key when it sends.
-- A company with no webhook queues nothing: its agent pulls its key with POST /cards/{card}/run-keys (issue_run_key).
create function public.enqueue_assignment_webhook() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; assigned_card_id bigint; company_slug text; company_name text; begin
 if tg_table_name='work_assignees' then target=new.person_id; assigned_card_id=new.card_id; else target=new.next_actor; assigned_card_id=new.id; end if;
 if target is null or not exists(select 1 from public.agent_keys k where k.company_id=new.company_id and k.person_id=target and k.kind='agent' and k.revoked_at is null) then return new; end if;
 if not exists(select 1 from public.agent_webhooks where company_id=new.company_id) then return new; end if;
 select slug,name into company_slug,company_name from public.companies where id=new.company_id;
 insert into public.webhook_deliveries(company_id,card_id,event) values(new.company_id,assigned_card_id,jsonb_build_object('company',jsonb_build_object('id',new.company_id,'slug',company_slug,'name',company_name),'card',assigned_card_id,'event_type','assigned','agent',jsonb_build_object('id',target,'name',(select name from public.people where id=target)),'card_path','/c/'||company_slug||'/work/board/'||assigned_card_id));
 return new;
end $$;
revoke all on function public.enqueue_assignment_webhook() from public, anon, authenticated;
create trigger enqueue_assignment_webhook after insert on public.work_assignees for each row execute function public.enqueue_assignment_webhook();
create trigger enqueue_assignment_webhook_actor after update of next_actor on public.work_cards for each row when (new.next_actor is distinct from old.next_actor) execute function public.enqueue_assignment_webhook();
create trigger enqueue_assignment_webhook_new after insert on public.work_cards for each row when (new.next_actor is not null) execute function public.enqueue_assignment_webhook();

-- Revoking a company grant also ends the agent's live run keys there, so a later grant does not bring them back.
create or replace function public.revoke_agent_access(c uuid, a uuid) returns void language plpgsql security definer set search_path='' as $$
declare found_agent public.agents%rowtype; begin
 if auth.uid() is null or not public.can_assign_owner(c) then raise exception 'not permitted to revoke agent access' using errcode='42501'; end if;
 update public.agent_grants set revoked_at=now(), revoked_by=auth.uid() where company_id=c and agent_id=a and revoked_at is null;
 if not found then raise exception 'grant not found'; end if;
 update public.members set removed_at=now() where company_id=c and person_id=a and removed_at is null;
 update public.agent_keys set revoked_at=now() where company_id=c and person_id=a and kind='run' and revoked_at is null;
 select * into found_agent from public.agents where id=a;
 insert into public.member_audit(company_id,actor_id,actor_name,person_id,person_name,action,before_data) values (c,auth.uid(),(select name from public.people where id=auth.uid()),a,(select name from public.people where id=a),'REVOKE_AGENT',jsonb_build_object('agent_role',found_agent.role));
end $$;

-- Database fence: the route puts the run key's card in the internal token, and agent_write refuses any other card.
create or replace function public.agent_write(c uuid, request_key text, fingerprint text, op text, card bigint, payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.agent_requests%rowtype; result jsonb; created bigint; ev text := payload->>'evidence'; begin
 if length(request_key)<1 or length(request_key)>200 then raise exception 'invalid idempotency key'; end if;
 -- A run key reaches its one card in the database as well as in the route.
 if auth.jwt()->>'run_card' is not null and card is distinct from (auth.jwt()->>'run_card')::bigint then raise exception 'not permitted'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text || auth.uid()::text || request_key,0));
 select * into existing from public.agent_requests r where r.company_id=c and r.person_id=auth.uid() and r.request_key=agent_write.request_key;
 if found then if existing.fingerprint<>fingerprint then raise exception 'idempotency key reused'; end if; return existing.result; end if;
 case op
 when 'create' then created=public.create_work_card(c,(payload->>'stage')::bigint,payload->>'title',coalesce(payload->>'template',''),ev); result=jsonb_build_object('id',created);
 when 'move' then perform public.move_work_card(c,card,(payload->>'stage')::bigint,ev); result='{}'::jsonb;
 when 'edit' then perform public.edit_work_card(c,card,payload->'fields',ev); result='{}'::jsonb;
 else
  if op in ('actor','assignee','label','check','comment','version','creative_with_version') then created=public.change_work_card(c,card,op,payload,ev); result=jsonb_build_object('id',created);
  else raise exception 'operation forbidden'; end if;
 end case;
 insert into public.agent_requests(company_id,person_id,request_key,fingerprint,result) values(c,auth.uid(),request_key,fingerprint,result);
 return result;
end $$;

-- The holder, or the agent that issued the keys, can end run keys on a card before they expire (run_key_id names one key, null means all of this agent's keys on the card).
create function public.revoke_run_keys(c uuid, card bigint, run_key_id uuid) returns integer language plpgsql security definer set search_path='' as $$
declare revoked_count integer; begin
 if auth.uid() is null then raise exception 'not permitted'; end if;
 update public.agent_keys set revoked_at=now() where company_id=c and card_id=card and person_id=auth.uid() and kind='run' and revoked_at is null and (run_key_id is null or id=run_key_id);
 get diagnostics revoked_count = row_count; return revoked_count;
end $$;
revoke all on function public.revoke_run_keys(uuid,bigint,uuid) from public, anon;
grant execute on function public.revoke_run_keys(uuid,bigint,uuid) to authenticated;
-- An Owner revoking a company key also ends the run keys that agent holds in the company.
create function public.agent_key_revoked() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.kind='agent' and new.revoked_at is not null and old.revoked_at is null then
  update public.agent_keys set revoked_at=now() where company_id=new.company_id and person_id=new.person_id and kind='run' and revoked_at is null;
 end if;
 return new;
end $$;
revoke all on function public.agent_key_revoked() from public, anon, authenticated;
create trigger agent_key_revoked after update of revoked_at on public.agent_keys for each row execute function public.agent_key_revoked();
