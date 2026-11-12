-- Hosted projects can grant these automatically; future API access must be explicit.
-- Existing objects keep their grants and RLS policies.
alter default privileges for role postgres in schema public
 revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
 revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
 revoke all on functions from anon, authenticated, service_role;
-- PostgreSQL's global PUBLIC EXECUTE cannot be revoked at schema scope.
alter default privileges for role postgres revoke execute on functions from public;
