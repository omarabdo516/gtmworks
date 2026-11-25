-- #774, #775: only an Owner changes an Owner, a Manager never changes their own row, and invitations are made by invite_member alone.
select json_build_object(
 'owner_changed_by_owner_only',position('ownerChangedByOwnerOnly' in pg_get_functiondef('public.guard_member()'::regprocedure))>0,
 'own_grants_unchangeable',position('ownGrantsUnchangeable' in pg_get_functiondef('public.guard_member()'::regprocedure))>0,
 'last_owner_kept',position('last owner cannot be removed or demoted' in pg_get_functiondef('public.guard_member()'::regprocedure))>0,
 'invitations_written_by_invite_member_only',not exists(select 1 from pg_policies where schemaname='public' and tablename='member_invitations' and cmd in ('INSERT','UPDATE','ALL'))
  and not has_table_privilege('authenticated','public.member_invitations','insert,update,delete')
  and has_table_privilege('authenticated','public.member_invitations','select')
);
