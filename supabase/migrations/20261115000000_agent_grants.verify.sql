-- The shared role agents and their company grants went with spec #695 (20270418000001_legacy_role_agents_cutover): no
-- table, guard or function of theirs is left.
select json_build_object(
 'removed_by_20270418000001',to_regclass('public.agents') is null and to_regclass('public.agent_grants') is null
  and not exists(select 1 from pg_trigger where tgrelid='public.members'::regclass and tgname='agent_membership_guard')
  and to_regprocedure('public.grant_agent_access(uuid,uuid)') is null and to_regprocedure('public.revoke_agent_access(uuid,uuid)') is null
  and to_regprocedure('public.agent_membership_guard()') is null
);
