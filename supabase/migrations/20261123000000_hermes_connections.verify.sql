select json_build_object(
 'hermes_rls',(select relrowsecurity from pg_class where oid='public.hermes_connections'::regclass),
 'ciphertext_not_readable',not has_column_privilege('authenticated','public.hermes_connections','key_encrypted','select') and not has_column_privilege('anon','public.hermes_connections','key_encrypted','select'),
 'server_can_read_ciphertext',has_column_privilege('service_role','public.hermes_connections','key_encrypted','select'),
 'ownership_immutable',not has_column_privilege('authenticated','public.hermes_connections','owner_id','update') and not has_column_privilege('authenticated','public.hermes_connections','company_id','update')
);
