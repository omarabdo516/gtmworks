-- The role agents' identities went with them (spec #695, 20270418000001_legacy_role_agents_cutover).
select json_build_object(
 'identities_removed_by_20270418000001',to_regprocedure('public.agent_identities()') is null
);
