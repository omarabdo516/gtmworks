-- The role key's guard went with the legacy role agents (spec #695, 20270418000001_legacy_role_agents_cutover); an
-- invitation is still claimed by signed-in people only.
select json_build_object(
 'agent_role_guard_removed_by_20270418000001',not exists(select 1 from pg_trigger where tgrelid='public.members'::regclass and tgname='member_agent_role_guard')
  and to_regprocedure('public.guard_member_agent_role()') is null,
 'invitation_claim',to_regprocedure('public.claim_invitations()') is not null,
 'authenticated_claim',has_function_privilege('authenticated','public.claim_invitations()','EXECUTE'),
 'anonymous_claim_blocked',not has_function_privilege('anon','public.claim_invitations()','EXECUTE')
);
