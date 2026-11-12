-- Local-only: reproduce the broad hosted profile before application migrations.
-- https://supabase.com/docs/guides/api/securing-your-api#default-privileges
-- TABLES includes views; PostgreSQL 17 ALL includes MAINTAIN.
alter default privileges for role postgres in schema public
 grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
 grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
 grant execute on functions to anon, authenticated, service_role;
