-- Credentials are never readable by ordinary members; owners manage only hashes.
create table public.agent_keys (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 person_id uuid not null, key_hash text not null unique, created_at timestamptz not null default now(),
 last_used_at timestamptz, revoked_at timestamptz,
 foreign key (company_id, person_id) references public.members(company_id, person_id)
);
alter table public.agent_keys enable row level security;
create policy agent_keys_owner_read on public.agent_keys for select to authenticated using (exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));
create policy agent_keys_owner_create on public.agent_keys for insert to authenticated with check (exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null) and exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=agent_keys.person_id and m.role='contributor' and m.removed_at is null));
create policy agent_keys_owner_update on public.agent_keys for update to authenticated using (exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null)) with check (exists(select 1 from public.members m where m.company_id=agent_keys.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));
-- The elevated lookup is restricted to the server's service role.
create function public.lookup_agent_key(hash text) returns table(key_id uuid, company_id uuid, person_id uuid, slug text) language plpgsql security definer set search_path='' as $$
begin
 return query update public.agent_keys k set last_used_at=now() from public.members m, public.companies c where k.key_hash=hash and k.revoked_at is null and m.company_id=k.company_id and m.person_id=k.person_id and m.removed_at is null and m.role='contributor' and c.id=k.company_id returning k.id,k.company_id,k.person_id,c.slug;
end $$;
revoke all on function public.lookup_agent_key(text) from public, anon, authenticated;
grant execute on function public.lookup_agent_key(text) to service_role;
create table public.agent_requests (company_id uuid not null, person_id uuid not null, request_key text not null, fingerprint text not null, result jsonb, created_at timestamptz not null default now(), primary key(company_id,person_id,request_key), foreign key(company_id,person_id) references public.members(company_id,person_id));
alter table public.agent_requests enable row level security;
create policy agent_requests_read on public.agent_requests for select to authenticated using (person_id=auth.uid() and public.is_member(company_id));
create policy agent_requests_insert on public.agent_requests for insert to authenticated with check (person_id=auth.uid() and public.is_member(company_id));
create function public.agent_write(c uuid, request_key text, fingerprint text, op text, card bigint, payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.agent_requests%rowtype; result jsonb; created bigint; ev text := payload->>'evidence'; begin
 if length(request_key)<1 or length(request_key)>200 then raise exception 'invalid idempotency key'; end if;
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
create table public.agent_rate_limits (company_id uuid not null, key_id uuid primary key references public.agent_keys(id), window_start timestamptz not null, requests integer not null);
alter table public.agent_rate_limits enable row level security;
create table public.agent_refusals (id bigint generated always as identity primary key, company_id uuid not null references public.companies(id), person_id uuid not null, key_id uuid not null references public.agent_keys(id), path text not null, created_at timestamptz not null default now());
alter table public.agent_refusals enable row level security;
create policy agent_refusals_owner_read on public.agent_refusals for select to authenticated using (exists(select 1 from public.members m where m.company_id=agent_refusals.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));
create function public.log_agent_refusal(c uuid, k uuid, request_path text) returns void language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.agent_keys where id=k and company_id=c and person_id=auth.uid() and revoked_at is null) then raise exception 'not permitted'; end if;
 insert into public.agent_refusals(company_id,person_id,key_id,path) values(c,auth.uid(),k,left(request_path,500));
end $$;
revoke all on function public.log_agent_refusal(uuid,uuid,text) from public, anon;
grant execute on function public.log_agent_refusal(uuid,uuid,text) to authenticated;
create function public.agent_rate_limit(k uuid) returns boolean language plpgsql security definer set search_path='' as $$ declare n integer; begin
 insert into public.agent_rate_limits(company_id,key_id,window_start,requests) select company_id,id,now(),1 from public.agent_keys where id=k and revoked_at is null
 on conflict(key_id) do update set window_start=case when public.agent_rate_limits.window_start <= now()-interval '1 minute' then now() else public.agent_rate_limits.window_start end, requests=case when public.agent_rate_limits.window_start <= now()-interval '1 minute' then 1 else public.agent_rate_limits.requests+1 end returning requests into n;
 return coalesce(n>120,true);
end $$;
revoke all on function public.agent_rate_limit(uuid) from public, anon, authenticated;
grant execute on function public.agent_rate_limit(uuid) to service_role;

create table public.agent_webhooks (company_id uuid primary key references public.companies(id), url text not null, secret_encrypted text not null, updated_at timestamptz not null default now());
alter table public.agent_webhooks enable row level security;
create policy agent_webhooks_owner on public.agent_webhooks for all to authenticated using (exists(select 1 from public.members m where m.company_id=agent_webhooks.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null)) with check (exists(select 1 from public.members m where m.company_id=agent_webhooks.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));
create table public.webhook_deliveries (id bigint generated always as identity primary key, company_id uuid not null references public.companies(id), card_id bigint not null, event jsonb not null, status text not null default 'pending' check(status in ('pending','delivering','delivered','failed')), attempts integer not null default 0, next_attempt_at timestamptz not null default now(), created_at timestamptz not null default now(), delivered_at timestamptz, last_status integer, last_error text, foreign key(company_id,card_id) references public.work_cards(company_id,id));
alter table public.webhook_deliveries enable row level security;
create policy webhook_deliveries_owner_read on public.webhook_deliveries for select to authenticated using (exists(select 1 from public.members m where m.company_id=webhook_deliveries.company_id and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null));
create function public.enqueue_person_webhook() returns trigger language plpgsql security definer set search_path='' as $$
declare company_slug text; company_name text; actor_name text; event_type text; begin
 if new.action not in ('approval_approved','approval_rejected','comment_added') or new.actor_id is null then return new; end if;
 if exists(select 1 from public.agent_keys where company_id=new.company_id and person_id=new.actor_id) then return new; end if;
 if not exists(select 1 from public.agent_webhooks where company_id=new.company_id) then return new; end if;
 select slug,name into company_slug,company_name from public.companies where id=new.company_id;
 select name into actor_name from public.people where id=new.actor_id;
 event_type=case new.action when 'approval_approved' then 'approved' when 'approval_rejected' then 'rejected' else 'commented' end;
 insert into public.webhook_deliveries(company_id,card_id,event) values(new.company_id,new.card_id,jsonb_build_object('company',jsonb_build_object('id',new.company_id,'slug',company_slug,'name',company_name),'card',new.card_id,'event_type',event_type,'actor',jsonb_build_object('id',new.actor_id,'name',actor_name),'reason',new.details->>'reason','marked_parts',jsonb_build_object('caption',coalesce((new.details->>'caption')::boolean,false),'design',coalesce((new.details->>'design')::boolean,false)),'comment',case when new.action='comment_added' then new.details->>'body' else null end,'card_path','/c/'||company_slug||'/work/board/'||new.card_id));
 return new;
end $$;
create trigger enqueue_person_webhook after insert on public.work_activity for each row execute function public.enqueue_person_webhook();
create function public.claim_webhook_deliveries() returns setof public.webhook_deliveries language sql security definer set search_path='' as $$
 update public.webhook_deliveries d set status='delivering', next_attempt_at=now()+interval '1 minute' where d.id in (select id from public.webhook_deliveries where (status='pending' or (status='delivering' and next_attempt_at<=now())) and next_attempt_at<=now() order by next_attempt_at,id for update skip locked limit 10) returning d.*;
$$;
revoke all on function public.claim_webhook_deliveries() from public, anon, authenticated;
grant execute on function public.claim_webhook_deliveries() to service_role;
