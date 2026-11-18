-- #158: a message that waited its turn and was refused by the Engine for the Conversation's model is told on its
-- sender's page as a sent one is (the model line under the composer), not as a turn the Engine would not start. The
-- refusal that puts the Conversation back on its earlier model (refuse_run_model) now also marks that waiting turn.
--
-- The column is new and false on every row, so nothing kept changes; the previous app version reads none of it and calls
-- refuse_run_model as before, which answers as before.
alter table public.conversation_queued_turns add column model_refused boolean not null default false;

create or replace function public.refuse_run_model(conversation uuid, message_key uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare refused jsonb; earlier jsonb;
begin
 select n.model into refused from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if refused is null or jsonb_typeof(refused)='null' then return false; end if;
 update public.conversations cv set model=cv.model_before, model_before=null where cv.id=conversation and cv.model=refused returning cv.model into earlier;
 if not found then return false; end if;
 update public.conversation_run_notes n set model=coalesce(earlier,'null'::jsonb) where n.conversation_id=conversation and n.send_key=message_key;
 update public.conversation_queued_turns q set model_refused=true where q.conversation_id=conversation and q.send_key=message_key and q.started_at is null;
 return true;
end $$;
revoke all on function public.refuse_run_model(uuid,uuid) from public,anon,authenticated;
grant execute on function public.refuse_run_model(uuid,uuid) to service_role;
