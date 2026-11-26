-- The role key this migration added went with the legacy role agents (spec #695, 20270418000001_legacy_role_agents_cutover):
-- no column, check, index or type is left of it. Members keep row-level security and their audit trigger.
select json_build_object(
 'role_key_removed_by_20270418000001',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='agent_role')
  and not exists(select 1 from pg_constraint where conrelid='public.members'::regclass and conname='members_agent_role_check')
  and not exists(select 1 from pg_indexes where schemaname='public' and tablename='members' and indexname='members_active_agent_role')
  and to_regtype('public.member_agent_role') is null,
 'members_rls',(select relrowsecurity from pg_class where oid='public.members'::regclass),
 'member_audit',exists(select 1 from pg_trigger where tgrelid='public.members'::regclass and tgname='member_audit_trigger' and not tgisinternal)
);
