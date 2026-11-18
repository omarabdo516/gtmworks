-- A choice claimed for a Run's permission request is delivered once (#163, #165), as a question's answer is since #138
-- (20270202000000_question_delivery_once): every closer (the press's own delivery, the page's or channel's read, the
-- worker) used to be handed every claim still sending, so two at once asked the Engine twice. A claim is now handed to
-- one closer at a time. A Conversation's request is a reply card and uses the column #138 added; a channel's gets its
-- own, new and empty, so nothing already kept changes, and the previous app calls both functions as before.
alter table public.channel_permissions add column delivering_at timestamptz;

create or replace function public.track_run_permission(conversation uuid, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz default null, run_profile text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare talk public.conversations; asked text:=asking->>'id'; own boolean; kept jsonb; named text; handed jsonb;
begin
 -- The lock a Run's end takes (close_ended_run_permissions), so a request is never kept after its Run has ended.
 perform pg_advisory_xact_lock(hashtextextended('permission_run:'||conversation::text||':'||run,0));
 select * into talk from public.conversations where id=conversation;
 if not found or not exists(select 1 from public.conversation_messages m where m.conversation_id=conversation and m.author='person' and m.run_id=run) then return '[]'::jsonb; end if;
 update public.reply_cards r set state='closed' where r.conversation_id=conversation and r.kind='permission'
  and (r.run_id=run and (ended and r.state in ('open','sending') or r.state='open' and r.call_id is distinct from asked and r.created_at<read_started_at)
   or r.state in ('open','sending') and r.run_id<>run and exists(select 1 from public.conversation_usage u where u.conversation_id=conversation and u.run_id=r.run_id));
 if asked is not null and not ended and not exists(select 1 from public.conversation_usage u where u.conversation_id=conversation and u.run_id=run) then
  own:=coalesce(run_profile=public.agent_engine_profile(talk.agent_id),false);
  kept:=jsonb_build_object('description',asking->'description','command',asking->'command','choices',
   case when jsonb_typeof(asking->'choices')='array' then coalesce((select jsonb_agg(o order by n) from jsonb_array_elements(asking->'choices') with ordinality x(o,n)
    where own or o<>'"always"'::jsonb),'[]'::jsonb) else asking->'choices' end);
  if length(asked) between 1 and 200 and public.reply_card_valid('permission','open',kept) then
   named:=btrim(case when btrim(kept->>'description',E' \t\r\n')<>'' then kept->>'description' else kept->>'command' end,E' \t\r\n');
   insert into public.reply_cards(company_id,conversation_id,run_id,call_id,kind,title,content,state,created_at)
    values(talk.company_id,conversation,run,asked,'permission',
     case when length(named)<=100 then named else rtrim(left(named,99),E' \t\r\n')||'…' end,kept,'open',greatest(read_started_at,coalesce(read_ended_at,read_started_at)))
    on conflict do nothing;
  end if;
 end if;
 -- Each claimed choice is handed to this closer alone, for 15 seconds (a choice's call to the Engine gives up after 10):
 -- another closer's read meanwhile gets nothing to deliver, so the Engine is asked once; a closer that died or could not
 -- reach the Engine leaves it to the first read after that.
 with given as (
  update public.reply_cards r set delivering_at=now()
   where r.conversation_id=conversation and r.run_id=run and r.kind='permission' and r.state='sending'
    and (r.delivering_at is null or r.delivering_at<now()-interval '15 seconds')
   returning r.id,r.call_id,r.content)
 select jsonb_agg(jsonb_build_object('card',g.id,'permission',g.call_id,'choice',g.content->'choice') order by g.id) into handed from given g;
 return coalesce(handed,'[]'::jsonb);
end $$;
revoke all on function public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text) to service_role;

create or replace function public.track_channel_permission(message bigint, run text, asking jsonb, ended boolean, read_started_at timestamptz, read_ended_at timestamptz default null, run_profile text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare called public.channel_runs; asked text:=asking->>'id'; own boolean; kept jsonb; named text; handed jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('channel_permission:'||message::text,0));
 select * into called from public.channel_runs where message_id=message and run_id=run;
 if not found then return '[]'::jsonb; end if;
 update public.channel_permissions p set state='closed' where p.message_id=message
  and ((ended or called.outcome is not null) and p.state in ('open','sending') or p.state='open' and p.request_id is distinct from asked and p.created_at<read_started_at);
 if asked is not null and not ended and called.outcome is null then
  own:=coalesce(run_profile=public.agent_engine_profile(called.agent_id),false);
  kept:=jsonb_build_object('description',asking->'description','command',asking->'command','choices',
   case when jsonb_typeof(asking->'choices')='array' then coalesce((select jsonb_agg(o order by n) from jsonb_array_elements(asking->'choices') with ordinality x(o,n)
    where own or o<>'"always"'::jsonb),'[]'::jsonb) else asking->'choices' end);
  if length(asked) between 1 and 200 and public.reply_card_valid('permission','open',kept) then
   named:=btrim(case when btrim(kept->>'description',E' \t\r\n')<>'' then kept->>'description' else kept->>'command' end,E' \t\r\n');
   insert into public.channel_permissions(company_id,channel_id,message_id,run_id,request_id,title,content,state,created_at)
    values(called.company_id,called.channel_id,message,run,asked,
     case when length(named)<=100 then named else rtrim(left(named,99),E' \t\r\n')||'…' end,kept,'open',greatest(read_started_at,coalesce(read_ended_at,read_started_at)))
    on conflict do nothing;
  end if;
 end if;
 -- One closer at a time, as in a Conversation.
 with given as (
  update public.channel_permissions p set delivering_at=now()
   where p.message_id=message and p.run_id=run and p.state='sending'
    and (p.delivering_at is null or p.delivering_at<now()-interval '15 seconds')
   returning p.id,p.request_id,p.content)
 select jsonb_agg(jsonb_build_object('card',g.id,'permission',g.request_id,'choice',g.content->'choice') order by g.id) into handed from given g;
 return coalesce(handed,'[]'::jsonb);
end $$;
revoke all on function public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text) to service_role;
