-- #774, #775: only an Owner changes an Owner, a Manager never changes their own row, and invitations are made by invite_member alone.
select json_build_object(
 'owner_changed_by_owner_only',position('ownerChangedByOwnerOnly' in pg_get_functiondef('public.guard_member()'::regprocedure))>0,
 'own_grants_unchangeable',position('ownGrantsUnchangeable' in pg_get_functiondef('public.guard_member()'::regprocedure))>0,
 'last_owner_kept',position('last owner cannot be removed or demoted' in pg_get_functiondef('public.guard_member()'::regprocedure))>0,
 'invitations_written_by_an_owner_only',(select count(*) from pg_policies where schemaname='public' and tablename='member_invitations' and cmd in ('INSERT','UPDATE'))=2
  and not exists(select 1 from pg_policies where schemaname='public' and tablename='member_invitations' and cmd in ('INSERT','UPDATE')
   and (coalesce(qual,'') like '%can_manage_company%' or coalesce(with_check,'') like '%can_manage_company%' or coalesce(with_check,'')||coalesce(qual,'') not like '%is_company_owner%'))
);
