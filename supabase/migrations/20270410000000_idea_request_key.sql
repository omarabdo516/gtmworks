-- #452: an idea from the Ideas column is made once per request key, as a request from New is (20261117000000_card_requests):
-- a second press of Add, or a retry after an answer that never arrived, returns the Card the first one made. An idea is
-- op 'idea', with its stage, title and Agent in the payload; everything else in agent_write is as 20270103000000 left it.
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
 when 'idea' then created=public.create_work_card(c,(payload->>'stage')::bigint,payload->>'title',(payload->>'agent')::uuid); result=jsonb_build_object('id',created);
 when 'move' then perform public.move_work_card(c,card,(payload->>'stage')::bigint,ev); result='{}'::jsonb;
 when 'edit' then perform public.edit_work_card(c,card,payload->'fields',ev); result='{}'::jsonb;
 else
  if op in ('actor','assignee','label','check','comment','version','creative_with_version') then created=public.change_work_card(c,card,op,payload,ev); result=jsonb_build_object('id',created);
  else raise exception 'operation forbidden'; end if;
 end case;
 insert into public.agent_requests(company_id,person_id,request_key,fingerprint,result) values(c,auth.uid(),request_key,fingerprint,result);
 return result;
end $$;
