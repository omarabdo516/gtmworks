-- #598: a discard's removal from the bucket never reaches the object a later send of the same key wrote.
-- A send that stores no message gives its images back in two steps: discard_conversation_files or discard_channel_files
-- deletes the rows and returns their paths, and once that commits the server removes those paths from the `creatives`
-- bucket. Every send of one key named the same paths (<send key>-<place>), so a concurrent send of that key (a double
-- click) that kept its rows again between the two steps wrote its images where the removal then took them: its turn
-- later read a missing image.
--
-- Each keep is now its own attempt: the rows a reserve adds are named by that attempt too
-- (<send key>-<attempt>-<place>), so a removal reaches only the objects of the rows it took. A send that finds the rows
-- still there writes the paths they already name (lib/message-files.ts reads them back), as a retry did before.
--
-- Additive (ADR 0023): the four-argument functions stay as they are, for the previous app version, which builds the
-- same old paths itself. This release calls the overload that names its attempt, built from the four-argument body with
-- only the path and its attempt changed. A Conversation's place keeps one row per send key and place: the old paths made
-- it unique, and now a reserve adds no row at a place the key already has. Rows the previous version kept are read back
-- by this one at the paths they name; the only send the window can miss is one key sent at once by both versions.
do $$
declare def text;
 conversation_path text:=$q$c::text||'/conversations/'||conversation::text||'/'||message_key::text||'-'||place::text$q$;
 channel_path text:=$q$c::text||'/channels/'||ch::text||'/'||message_key::text||'-'||place::text$q$;
 conversation_conflict text:=$q$  on conflict (company_id,path) do nothing;$q$;
begin
 def:=pg_get_functiondef('public.reserve_conversation_files(uuid,uuid,uuid,jsonb)'::regprocedure);
 if position('files jsonb)' in def)=0 or position(conversation_path in def)=0 or position(conversation_conflict in def)=0
  or position('message_key is null or files is null' in def)=0 then
  raise exception 'reserve_conversation_files changed: %',def; end if;
 def:=replace(def,'files jsonb)','files jsonb, attempt uuid)');
 def:=replace(def,'message_key is null or files is null','message_key is null or attempt is null or files is null');
 def:=replace(def,conversation_path,$q$c::text||'/conversations/'||conversation::text||'/'||message_key::text||'-'||attempt::text||'-'||place::text$q$);
 def:=replace(def,conversation_conflict,$q$  where not exists(select 1 from public.conversation_attachments a
   where a.conversation_id=conversation and a.company_id=c and a.send_key=message_key and a.position=p.place)
  on conflict (company_id,path) do nothing;$q$);
 execute def;

 def:=pg_get_functiondef('public.reserve_channel_files(uuid,uuid,uuid,jsonb)'::regprocedure);
 if position('files jsonb)' in def)=0 or position(channel_path in def)=0 or position('message_key is null or files is null' in def)=0 then
  raise exception 'reserve_channel_files changed: %',def; end if;
 def:=replace(def,'files jsonb)','files jsonb, attempt uuid)');
 def:=replace(def,'message_key is null or files is null','message_key is null or attempt is null or files is null');
 -- A channel's place is already unique per send key (channel_id, send_key, position), so its insert adds no second row.
 def:=replace(def,channel_path,$q$c::text||'/channels/'||ch::text||'/'||message_key::text||'-'||attempt::text||'-'||place::text$q$);
 execute def;
end $$;
revoke all on function public.reserve_conversation_files(uuid,uuid,uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function public.reserve_conversation_files(uuid,uuid,uuid,jsonb,uuid) to authenticated;
revoke all on function public.reserve_channel_files(uuid,uuid,uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function public.reserve_channel_files(uuid,uuid,uuid,jsonb,uuid) to authenticated;
