-- #953, first step: an invitation carries an end, and the claim, the channel readers and the owner guard skip an ended
-- one. The row behind these checks is proven in tests/email-invitations-migration.mjs.
select json_build_object(
 'ended_column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='member_invitations' and column_name='ended_at'),
 'batch_link_maker',has_function_privilege('authenticated','public.make_invite_links(uuid,text[],text[],text[])','execute')
  and not has_function_privilege('anon','public.make_invite_links(uuid,text[],text[],text[])','execute'),
 'claim_skips_ended',position('ended_at is null' in pg_get_functiondef('public.claim_invitations()'::regprocedure))>0,
 'channels_skip_ended',position('ended_at is null' in pg_get_functiondef('public.channel_members(uuid)'::regprocedure))>0
  and position('ended_at is null' in pg_get_functiondef('public.set_channel_invitee(uuid,uuid,boolean)'::regprocedure))>0
  and position('ended_at is null' in pg_get_functiondef('public.create_channel_inviting(uuid,uuid,text,uuid[],uuid[],uuid[])'::regprocedure))>0,
 'owner_guard_skips_ended',position('ended_at is null' in pg_get_functiondef('public.guard_member()'::regprocedure))>0
);
