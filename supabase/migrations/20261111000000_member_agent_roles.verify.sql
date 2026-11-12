select json_build_object(
 'agent_role_guard',exists(select 1 from pg_trigger where tgrelid='public.members'::regclass and tgname='member_agent_role_guard' and tgenabled='O' and not tgisinternal),
 'invitation_claim',to_regprocedure('public.claim_invitations()') is not null,
 'authenticated_claim',has_function_privilege('authenticated','public.claim_invitations()','EXECUTE'),
 'anonymous_claim_blocked',not has_function_privilege('anon','public.claim_invitations()','EXECUTE')
);
