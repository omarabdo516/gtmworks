-- #704, spec #695, ADR 0023: after the cutover the legacy role agents are removed whole. No table, column, type, trigger
-- or function keeps them, and no function names them; what they wrote keeps its name, and the members' change log keeps
-- the role keys and grant rows it stored.
select json_build_object(
 'no_tables',to_regclass('public.agents') is null and to_regclass('public.agent_grants') is null,
 'no_role_key',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='agent_role')
  and to_regtype('public.member_agent_role') is null,
 'no_functions',to_regprocedure('public.grant_agent_access(uuid,uuid)') is null and to_regprocedure('public.revoke_agent_access(uuid,uuid)') is null
  and to_regprocedure('public.company_agents(uuid)') is null and to_regprocedure('public.agent_identities()') is null
  and to_regprocedure('public.guard_member_agent_role()') is null and to_regprocedure('public.agent_membership_guard()') is null
  and to_regprocedure('public.settle_legacy_role_agents()') is null,
 'no_function_names_them',not exists(select 1 from pg_proc where pronamespace='public'::regnamespace
  and (prosrc ~ '\mpublic\.agents\M' or prosrc ~ '\magent_grants\M' or prosrc ~ '\magent_role\M' or prosrc ~ '\mmember_agent_role\M'
   or prosrc ~ '\mcompany_agents\(' or prosrc ~ '\magent_identities\(')),
 'no_trigger',not exists(select 1 from pg_trigger where tgrelid='public.members'::regclass and tgname in ('member_agent_role_guard','agent_membership_guard')),
 'members_still_guarded',exists(select 1 from pg_trigger where tgrelid='public.members'::regclass and tgfoid='public.guard_member()'::regprocedure),
 'names_stay',to_regclass('public.people') is not null
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='member_audit' and column_name='before_data'),
 'invitations_still_claimed',has_function_privilege('authenticated','public.claim_invitations()','execute')
);
