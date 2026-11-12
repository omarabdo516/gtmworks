-- A new card is a message to an agent: one card, its first message and its assignment, created together in Ideas.
-- The mode says what the agent should do with the message. Cards made before this migration have no mode.
alter table public.work_cards add column mode text check (mode in ('plan','do','answer'));

-- Ideas is a stage of its own kind, so a request enters it however the stages are renamed or reordered.
-- The Ideas stage is the first one each company was created with (the lowest id, as the approvals migration also reads the originals), whatever order the stages are in today.
do $$ declare k name; begin for k in select conname from pg_constraint where conrelid='public.work_stages'::regclass and contype='c' and pg_get_constraintdef(oid) like '%before_review%' loop execute format('alter table public.work_stages drop constraint %I',k); end loop; end $$;
alter table public.work_stages add constraint work_stages_kind_check check (kind in ('ideas','before_review','review','after_review'));
alter table public.work_stages disable trigger work_stage_kind_guard;
update public.work_stages s set kind='ideas' where s.kind='before_review' and s.id=(select min(x.id) from public.work_stages x where x.company_id=s.company_id);
alter table public.work_stages enable trigger work_stage_kind_guard;
create unique index work_stages_one_ideas on public.work_stages(company_id) where kind='ideas';
create or replace function public.work_defaults() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.work_stages(company_id,name,position,kind) select new.id,n,ord,case when ord=1 then 'ideas' when ord=5 then 'review' when ord>5 then 'after_review' else 'before_review' end from unnest(array['أفكار','بريف جاهز','كتابة','تصميم ومونتاج','مراجعة','معتمد','مجدول للنشر','منشور','إعلانات شغالة']) with ordinality as x(n,ord);
 insert into public.work_labels(company_id,name,color) select new.id,n,c from (values ('static','#87bba2'),('reel','#bd8d81'),('carosel','#cdbb78'),('Paid','#a58bc1'),('content','#83a6be'),('Campaign','#d6a76f'),('Urgent','#d78484'),('Website','#8abbb7')) x(n,c); return new; end $$;

-- A request is remembered per person and key. An agency owner who is not a member of the company may create cards, so the key table follows the person, not a membership.
do $$ declare k name; begin for k in select conname from pg_constraint where conrelid='public.agent_requests'::regclass and contype='f' loop execute format('alter table public.agent_requests drop constraint %I',k); end loop; end $$;
alter table public.agent_requests add foreign key (person_id) references public.people(id);
drop policy agent_requests_read on public.agent_requests;
drop policy agent_requests_insert on public.agent_requests;
create policy agent_requests_read on public.agent_requests for select to authenticated using (person_id=auth.uid() and (public.is_member(company_id) or public.agency_access()));
create policy agent_requests_insert on public.agent_requests for insert to authenticated with check (person_id=auth.uid() and (public.is_member(company_id) or public.agency_access()));

-- The role agents of a company, from their stable identities (public.agents) and the company's grants, never from the role key a membership carries.
-- granted: the grant is active and the agent is an active member. Any member of the company can read this; the grant table itself is for Owners.
create function public.company_agents(c uuid) returns table(person_id uuid, role text, granted boolean) language sql stable security definer set search_path='' as $$
 select a.id, a.role, exists(select 1 from public.agent_grants g join public.members m on m.company_id=g.company_id and m.person_id=g.agent_id and m.removed_at is null where g.company_id=c and g.agent_id=a.id and g.revoked_at is null)
 from public.agents a where public.is_member(c) or public.agency_access();
$$;
revoke all on function public.company_agents(uuid) from public, anon;
grant execute on function public.company_agents(uuid) to authenticated;

create function public.create_card_request(c uuid, message text, agent uuid, card_mode text) returns bigint language plpgsql security invoker set search_path='' as $$
declare result bigint; first_stage bigint; text_body text := btrim(coalesce(message,'')); begin
 if not public.work_can_edit(c) then raise exception 'not permitted'; end if;
 if text_body='' or card_mode is null or card_mode not in ('plan','do','answer') then raise exception 'invalid request' using errcode='22023'; end if;
  -- Only an agent the company has granted (a role agent with an active grant and membership) can be asked.
 if not exists(select 1 from public.company_agents(c) x where x.person_id=agent and x.granted) then raise exception 'agent not found'; end if;
 select id into first_stage from public.work_stages where company_id=c and kind='ideas';
 if first_stage is null then raise exception 'no Ideas stage'; end if;
 insert into public.work_cards(company_id,stage_id,title,mode) values (c,first_stage,left(btrim(split_part(text_body,E'\n',1)),80),card_mode) returning id into result;
 insert into public.work_assignees(company_id,card_id,person_id) values (c,result,agent);
 insert into public.work_comments(company_id,card_id,body) values (c,result,text_body);
 return result;
end $$;
revoke all on function public.create_card_request(uuid,text,uuid,text) from public, anon;
grant execute on function public.create_card_request(uuid,text,uuid,text) to authenticated;

-- Card creation through agent_write is idempotent per person and key. A body with a message is a card request.
create or replace function public.agent_write(c uuid, request_key text, fingerprint text, op text, card bigint, payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.agent_requests%rowtype; result jsonb; created bigint; ev text := payload->>'evidence'; begin
 if length(request_key)<1 or length(request_key)>200 then raise exception 'invalid idempotency key'; end if;
 -- A run key reaches its one card in the database as well as in the route.
 if auth.jwt()->>'run_card' is not null and card is distinct from (auth.jwt()->>'run_card')::bigint then raise exception 'not permitted'; end if;
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
