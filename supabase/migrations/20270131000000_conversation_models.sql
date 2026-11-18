-- #158: the "+" menu's Model. The Owner picks, for one of their own Conversations, a model the Agent's Engine offers;
-- every later Run of that Conversation is sent with it, through the Engine's own per-Run choice
-- (gateway/platforms/api_server.py 269-291). The Agent's saved model is never changed, and no other Conversation is.
-- The choice is kept on the Conversation, with the one before it, and each Run is pinned with the choice at its first
-- start (pin_run_model, beside pin_run_knowledge), so a retry sends what it first sent. A Run the Engine refused for its
-- model puts the Conversation back on the model before it (refuse_run_model).
--
-- Nothing existing is rewritten: the new columns start empty, which is the Agent's own model. The previous app version
-- reads none of them and pins none, so its Runs go on as before.

alter table public.conversations add column model jsonb, add column model_before jsonb;
alter table public.conversation_run_notes add column model jsonb;

-- A choice is a provider and a model the Engine names, nothing else; null is the Agent's own model.
create function public.model_choice_valid(choice jsonb) returns boolean language sql immutable set search_path='' as $$
 select choice is null or jsonb_typeof(choice)='object' and (select array_agg(k order by k) from jsonb_object_keys(choice) k)=array['model','provider']
  and jsonb_typeof(choice->'provider')='string' and jsonb_typeof(choice->'model')='string'
  and length(btrim(choice->>'provider')) between 1 and 200 and length(btrim(choice->>'model')) between 1 and 200;
$$;
revoke all on function public.model_choice_valid(jsonb) from public,anon,authenticated,service_role;
alter table public.conversations add constraint conversations_model_valid check (public.model_choice_valid(model) and public.model_choice_valid(model_before));

-- The Owner alone picks (a model that costs more spends the Company's subscription faster), in their own Conversation.
create function public.set_conversation_model(c uuid, conversation uuid, choice jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare talk public.conversations;
begin
 select * into talk from public.conversations cv where cv.id=conversation and cv.company_id=c and cv.person_id=auth.uid() and public.is_member(c) for update;
 if not found then raise exception 'conversationNotFound' using errcode='P0002'; end if;
 if not public.is_company_owner(c) then raise exception 'conversationNotAllowed' using errcode='42501'; end if;
 if jsonb_typeof(choice)='null' then choice:=null; end if;
 if not public.model_choice_valid(choice) then raise exception 'conversationModelInvalid' using errcode='22023'; end if;
 if talk.model is distinct from choice then
  update public.conversations set model_before=talk.model, model=choice where id=conversation;
 end if;
 return choice;
end $$;
revoke all on function public.set_conversation_model(uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.set_conversation_model(uuid,uuid,jsonb) to authenticated;

-- The model a Run is sent with: the one pinned at its first start, pinned now from its Conversation when this is the
-- first. JSON null is no choice; a Run the previous app version already tried to start is pinned with none.
create function public.pin_run_model(conversation uuid, message_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare held public.conversation_run_reservations; kept public.conversation_run_notes;
begin
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key for update;
 select * into kept from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if kept.conversation_id is null then return 'null'::jsonb; end if;
 if kept.model is null then
  update public.conversation_run_notes n set model=case when held.conversation_id is not null and held.start_attempts=0 and held.start_unknown_at is null
    then coalesce((select cv.model from public.conversations cv where cv.id=conversation),'null'::jsonb) else 'null'::jsonb end
   where n.conversation_id=conversation and n.send_key=message_key returning * into kept;
 end if;
 return kept.model;
end $$;
revoke all on function public.pin_run_model(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pin_run_model(uuid,uuid) to service_role;

-- The Engine refused this Run's model, so the Run never started: while the Conversation is still on that model it goes
-- back to the one before, and the Run, sent again, carries that one. True when the Conversation changed.
create function public.refuse_run_model(conversation uuid, message_key uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare refused jsonb; earlier jsonb;
begin
 select n.model into refused from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if refused is null or jsonb_typeof(refused)='null' then return false; end if;
 update public.conversations cv set model=cv.model_before, model_before=null where cv.id=conversation and cv.model=refused returning cv.model into earlier;
 if not found then return false; end if;
 update public.conversation_run_notes n set model=coalesce(earlier,'null'::jsonb) where n.conversation_id=conversation and n.send_key=message_key;
 return true;
end $$;
revoke all on function public.refuse_run_model(uuid,uuid) from public,anon,authenticated;
grant execute on function public.refuse_run_model(uuid,uuid) to service_role;
