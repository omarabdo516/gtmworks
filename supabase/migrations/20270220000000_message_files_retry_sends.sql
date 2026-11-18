-- #355 review: an image-only retry of a send whose message is already stored is that same send. The empty body is
-- accepted when the send key's images are already linked to this sender's own stored message, so the post reaches the
-- send key's own deduplication (the insert conflicts, and the key's message answers) instead of failing before it.
--
-- Additive: only the empty-body rule of post_channel_message changes. Every message the previous app version posts keeps
-- its text, an empty body with nothing of the sender's under its key is still refused, and no row is dropped or
-- rewritten.

do $$
declare def text;
begin
 def:=pg_get_functiondef('public.post_channel_message(uuid,uuid,text)'::regprocedure);
 if position($q$(btrim(message)='' and not exists(select 1 from public.channel_attachments a where a.channel_id=ch and a.send_key=message_key and a.message_id is null and a.person_id=auth.uid()))$q$ in def)=0 then
  raise exception 'post_channel_message changed: %',def; end if;
 execute replace(def,
  $q$(btrim(message)='' and not exists(select 1 from public.channel_attachments a where a.channel_id=ch and a.send_key=message_key and a.message_id is null and a.person_id=auth.uid()))$q$,
  $q$(btrim(message)='' and not exists(select 1 from public.channel_attachments a left join public.channel_messages m on m.id=a.message_id where a.channel_id=ch and a.send_key=message_key and a.person_id=auth.uid() and (a.message_id is null or (m.channel_id=ch and m.send_key=message_key and m.person_id=auth.uid() and m.author='person'))))$q$);
end $$;
