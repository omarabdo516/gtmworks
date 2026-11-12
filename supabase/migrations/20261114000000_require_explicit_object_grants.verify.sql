select json_build_object(
 'no_automatic_client_grants', not exists (
  select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
  where d.defaclrole='postgres'::regrole
   and d.defaclnamespace in (0, 'public'::regnamespace)
   and d.defaclobjtype in ('r','S','f')
   and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
 ),
 'global_public_execute_revoked', not exists (
  select 1 from aclexplode(coalesce(
   (select defaclacl from pg_default_acl
    where defaclrole='postgres'::regrole and defaclnamespace=0 and defaclobjtype='f'),
   acldefault('f', 'postgres'::regrole)
  )) a where a.grantee=0 and a.privilege_type='EXECUTE'
 )
);
