-- #207: an invitation is a name, a Role and one quiet line in its Company's general channel, its email only for the
-- Owner and the Managers; a team channel holds the invitations it was given, and create_channel takes them.
select json_build_object(
 'invitees_table',to_regclass('public.channel_invitees') is not null,
 'notes_table',to_regclass('public.channel_notes') is not null,
 'both_tables_guarded',(select count(*)::int from pg_class c where c.oid in ('public.channel_invitees'::regclass,'public.channel_notes'::regclass) and c.relrowsecurity)=2,
 'members_columns',(select array_agg(name order by position) from unnest((select proargnames from pg_proc
  where oid='public.channel_members(uuid)'::regprocedure)) with ordinality t(name,position) where position>1)=array['person','name','role','invitation','email'],
 'email_only_for_the_owner_and_managers',position('can_manage_company' in pg_get_functiondef('public.channel_members(uuid)'::regprocedure))>0,
 'one_line_per_invitation',exists(select 1 from pg_constraint where conrelid='public.channel_notes'::regclass and contype='u'),
 'note_once_written',(select count(*)::int from pg_trigger where tgfoid='public.note_member_invitation()'::regprocedure and tgrelid='public.member_invitations'::regclass and not tgisinternal)=2,
 'invitee_writes',has_function_privilege('authenticated','public.set_channel_invitee(uuid,uuid,boolean)','execute'),
 'create_channel_takes_invitees',position('invitees' in pg_get_functiondef('public.create_channel_inviting(uuid,uuid,text,uuid[],uuid[],uuid[])'::regprocedure))>0,
 'previous_version_still_makes_one',to_regprocedure('public.create_channel(uuid,uuid,text,uuid[],uuid[])') is not null,
 'claiming_joins_their_channels',position('channel_invitees' in pg_get_functiondef('public.claim_invitations()'::regprocedure))>0,
 'email_hidden_from_readers',not has_column_privilege('authenticated','public.channel_notes','invitation_id','select')
);
