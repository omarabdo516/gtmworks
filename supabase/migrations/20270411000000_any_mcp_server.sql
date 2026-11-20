-- #458: a Company's apps are the pinned Engine's whole catalogue plus servers the Owner adds by address. One Engine
-- catalogue name has an underscore (`hugging_face`), and a server gtmworks makes has hyphens, so the sign-in table and
-- the two functions that check a key accept `_` beside `-`. Nothing else changes: the new values are only accepted
-- where the old ones were, and every function keeps its Owner check, its empty search path and its own privileges.
--
-- Nothing existing is rewritten: no row holds an underscore today, and the previous app version runs against this
-- database unchanged.

alter table public.company_app_sign_ins drop constraint company_app_sign_ins_app_check;
alter table public.company_app_sign_ins add constraint company_app_sign_ins_app_check check (app ~ '^[a-z][a-z0-9_-]{0,63}$');

create or replace function public.start_app_sign_in(c uuid, app_key text, flow text, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'appsNotAllowed' using errcode='42501'; end if;
 if coalesce(app_key,'') !~ '^[a-z][a-z0-9_-]{0,63}$' or coalesce(flow,'') !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'appsInvalid' using errcode='22023'; end if;
 if not exists(select 1 from public.company_app_agents(c) x where x.agent=start_app_sign_in.agent and x.own) then raise exception 'appsAgentNotOwn' using errcode='42501'; end if;
 delete from public.company_app_sign_ins s where s.started_by=auth.uid() and s.app=app_key and s.finished_at is null;
 insert into public.company_app_sign_ins(company_id,app,flow_id,started_by,agent_id) values (c,app_key,flow,auth.uid(),start_app_sign_in.agent);
end $$;
revoke all on function public.start_app_sign_in(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.start_app_sign_in(uuid,text,text,uuid) to authenticated;

create or replace function public.record_app_disconnected(c uuid, app_key text, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'appsNotAllowed' using errcode='42501'; end if;
 if coalesce(app_key,'') !~ '^[a-z][a-z0-9_-]{0,63}$' then raise exception 'appsInvalid' using errcode='22023'; end if;
 if not exists(select 1 from public.company_app_agents(c) x where x.agent=record_app_disconnected.agent and x.own) then raise exception 'appsAgentNotOwn' using errcode='42501'; end if;
 insert into public.company_audit(company_id,actor_id,action,app,agent_id) values (c,auth.uid(),'app_disconnected',app_key,record_app_disconnected.agent);
end $$;
revoke all on function public.record_app_disconnected(uuid,text,uuid) from public,anon,service_role;
grant execute on function public.record_app_disconnected(uuid,text,uuid) to authenticated;

-- An app that needs no sign-in, or one turned on with a pasted token, is connected by the Engine's own reach. gtmworks
-- records that turn-on with its Agent, as a finished sign-in is recorded, so the Activity log names it once.
create function public.record_app_connected(c uuid, app_key text, agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_company_owner(c) then raise exception 'appsNotAllowed' using errcode='42501'; end if;
 if coalesce(app_key,'') !~ '^[a-z][a-z0-9_-]{0,63}$' then raise exception 'appsInvalid' using errcode='22023'; end if;
 if not exists(select 1 from public.company_app_agents(c) x where x.agent=record_app_connected.agent and x.own) then raise exception 'appsAgentNotOwn' using errcode='42501'; end if;
 insert into public.company_audit(company_id,actor_id,action,app,agent_id) values (c,auth.uid(),'app_connected',app_key,record_app_connected.agent);
end $$;
revoke all on function public.record_app_connected(uuid,text,uuid) from public,anon,service_role;
grant execute on function public.record_app_connected(uuid,text,uuid) to authenticated;

-- A connect card names an app by its key, and the Engine's catalogue name `hugging_face` now reaches one; the same
-- widening as the sign-in table above (20270201000000's function, unchanged otherwise).
create or replace function public.reply_card_valid(kind text, state text, content jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(case kind
  when 'draft' then state='shown' and case when jsonb_typeof(content)='object' then
   (select array_agg(k order by k) from jsonb_object_keys(content) k)=array['line','rows']
   and public.reply_card_text(content->'line',160)
   and case when jsonb_typeof(content->'rows')='array' then jsonb_array_length(content->'rows')<=8
    and not exists(select 1 from jsonb_array_elements(content->'rows') r where not case when jsonb_typeof(r)='object' then
     (select array_agg(k order by k) from jsonb_object_keys(r) k)=array['label','value']
     and public.reply_card_text(r->'label',40) and public.reply_card_text(r->'value',240) else false end) else false end
  else false end
  when 'review' then state='shown' and case when jsonb_typeof(content)='object' then
   (select array_agg(k order by k) from jsonb_object_keys(content) k)=array['decision','items','line']
   and public.reply_card_text(content->'line',160)
   and public.reply_card_text(content->'decision',160)
   and case when jsonb_typeof(content->'items')='array' then jsonb_array_length(content->'items') between 1 and 8
    and not exists(select 1 from jsonb_array_elements(content->'items') i where not case when jsonb_typeof(i)='object' then
     (select array_agg(k order by k) from jsonb_object_keys(i) k)=array['fine','note','text']
     and jsonb_typeof(i->'fine')='boolean'
     and public.reply_card_text(i->'text',240) and public.reply_card_text(i->'note',240) else false end) else false end
  else false end
  when 'question' then case when jsonb_typeof(content)='object' then
   case (select array_agg(k order by k) from jsonb_object_keys(content) k)
    when array['choices','multiple','question'] then state in ('open','closed')
    when array['answer','choices','multiple','question'] then state in ('sending','answered','closed')
     and jsonb_typeof(content->'answer')='string' and length(content->>'answer') between 1 and 20000 and btrim(content->>'answer',E' \t\r\n')<>''
    else false end
   and public.reply_card_text(content->'question',4000)
   and jsonb_typeof(content->'multiple')='boolean'
   and case when jsonb_typeof(content->'choices')='array' then jsonb_array_length(content->'choices')<=4
    and not exists(select 1 from jsonb_array_elements(content->'choices') o where not coalesce(jsonb_typeof(o)='string'
     and length(o#>>'{}') between 1 and 1000 and btrim(o#>>'{}',E' \t\r\n')<>'',false)) else false end
  else false end
  when 'hand' then state in ('open','done') and case when jsonb_typeof(content)='object' then
   (select array_agg(k order by k) from jsonb_object_keys(content) k) in
    (array['app','line','rows'],array['app','line','rows','url'],array['app','line','note','rows'],array['app','line','note','rows','url'])
   and public.reply_card_text(content->'app',40)
   and public.reply_card_text(content->'line',160)
   and case when jsonb_typeof(content->'rows')='array' then jsonb_array_length(content->'rows')<=8
    and not exists(select 1 from jsonb_array_elements(content->'rows') r where not case when jsonb_typeof(r)='object' then
     (select array_agg(k order by k) from jsonb_object_keys(r) k)=array['label','value']
     and public.reply_card_text(r->'label',40) and public.reply_card_text(r->'value',240) else false end) else false end
   and (not content ? 'url' or coalesce(jsonb_typeof(content->'url')='string' and content->>'url' ~* '^https://[^[:space:]]+$' and length(content->>'url')<=2000,false))
   and (not content ? 'note' or public.reply_card_text(content->'note',240))
  else false end
  when 'permission' then case when jsonb_typeof(content)='object' then
   case (select array_agg(k order by k) from jsonb_object_keys(content) k)
    when array['choices','command','description'] then state in ('open','closed')
    when array['choice','choices','command','description'] then state in ('sending','decided','closed')
     and jsonb_typeof(content->'choice')='string' and content->'choices' ? (content->>'choice')
    else false end
   and jsonb_typeof(content->'description')='string' and length(content->>'description')<=4000
   and jsonb_typeof(content->'command')='string' and length(content->>'command')<=4000
   and btrim((content->>'description')||(content->>'command'),E' \t\r\n')<>''
   and case when jsonb_typeof(content->'choices')='array' then jsonb_array_length(content->'choices')<=3
    and content->'choices' ?& array['once','deny']
    and not exists(select 1 from jsonb_array_elements(content->'choices') o where not coalesce(o#>>'{}' in ('once','always','deny'),false))
    and (select count(distinct o) from jsonb_array_elements(content->'choices') o)=jsonb_array_length(content->'choices') else false end
  else false end
  when 'connect' then state in ('open','postponed') and case when jsonb_typeof(content)='object' then
   (select array_agg(k order by k) from jsonb_object_keys(content) k)=array['app','reason']
   and coalesce(jsonb_typeof(content->'app')='string' and content->>'app' ~ '^[a-z][a-z0-9_-]{0,63}$',false)
   and public.reply_card_text(content->'reason',200)
  else false end
 end,false);
$$;
