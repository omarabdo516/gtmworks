-- #953: pending email invitations are ended, no new one is made, and the claim and the channel readers skip an ended
-- invitation. The row behind these checks is proven in tests/email-invitations-migration.mjs.
select json_build_object(
 'ended_column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='member_invitations' and column_name='ended_at'),
 'member_reads_only',has_table_privilege('authenticated','public.member_invitations','select')
  and not has_table_privilege('authenticated','public.member_invitations','insert')
  and not has_table_privilege('authenticated','public.member_invitations','update')
  and not has_table_privilege('authenticated','public.member_invitations','delete')
  and not has_table_privilege('authenticated','public.member_invitations','truncate'),
 'visitors_read_nothing',not has_table_privilege('anon','public.member_invitations','select')
  and not has_table_privilege('anon','public.member_invitations','insert,update,delete,truncate'),
 'email_invite_maker_refuses',position('inviteEmailRetired' in pg_get_functiondef('public.invite_member(uuid,text,text,boolean)'::regprocedure))>0,
 'claim_skips_ended',position('ended_at is null' in pg_get_functiondef('public.claim_invitations()'::regprocedure))>0,
 'channels_skip_ended',position('ended_at is null' in pg_get_functiondef('public.channel_members(uuid)'::regprocedure))>0
  and position('ended_at is null' in pg_get_functiondef('public.set_channel_invitee(uuid,uuid,boolean)'::regprocedure))>0
  and position('ended_at is null' in pg_get_functiondef('public.create_channel_inviting(uuid,uuid,text,uuid[],uuid[],uuid[])'::regprocedure))>0,
 'owner_guard_skips_ended',position('ended_at is null' in pg_get_functiondef('public.guard_member()'::regprocedure))>0
);
