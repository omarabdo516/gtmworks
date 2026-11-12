select json_build_object(
 'agent_role',exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='agent_role' and udt_name='member_agent_role' and is_nullable='YES'),
 'role_constraint',exists(select 1 from pg_constraint where conrelid='public.members'::regclass and conname='members_agent_role_check'),
 'unique_active_role',exists(select 1 from pg_indexes where schemaname='public' and tablename='members' and indexname='members_active_agent_role' and indexdef like 'CREATE UNIQUE INDEX%WHERE ((agent_role IS NOT NULL) AND (removed_at IS NULL))'),
 'members_rls',(select relrowsecurity from pg_class where oid='public.members'::regclass),
 'role_readable',has_column_privilege('authenticated','public.members','agent_role','SELECT'),
 'member_audit',exists(select 1 from pg_trigger where tgrelid='public.members'::regclass and tgname='member_audit_trigger' and not tgisinternal)
);
