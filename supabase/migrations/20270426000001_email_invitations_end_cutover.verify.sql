-- #953, the cutover: pending email invitations are ended, no Member makes or changes one, the maker refuses, and the
-- table keeps only its ended rows to read. The row behind these checks is proven in tests/email-invitations-migration.mjs.
select json_build_object(
 'member_reads_only',has_table_privilege('authenticated','public.member_invitations','select')
  and not has_table_privilege('authenticated','public.member_invitations','insert')
  and not has_table_privilege('authenticated','public.member_invitations','update')
  and not has_table_privilege('authenticated','public.member_invitations','delete')
  and not has_table_privilege('authenticated','public.member_invitations','truncate'),
 'visitors_read_nothing',not has_table_privilege('anon','public.member_invitations','select')
  and not has_table_privilege('anon','public.member_invitations','insert,update,delete,truncate'),
 'email_invite_maker_refuses',position('inviteEmailRetired' in pg_get_functiondef('public.invite_member(uuid,text,text,boolean)'::regprocedure))>0,
 'agent_switch_kept',to_regprocedure('public.set_invitation_agent_visible(uuid,uuid,uuid,boolean)') is not null,
 'claim_skips_ended',position('ended_at is null' in pg_get_functiondef('public.claim_invitations()'::regprocedure))>0,
 'owner_guard_skips_ended',position('ended_at is null' in pg_get_functiondef('public.guard_member()'::regprocedure))>0
);
