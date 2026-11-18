select json_build_object(
 'anonymous_member_lookup_blocked',not has_function_privilege('anon','public.is_member(uuid)','EXECUTE'),
 'anonymous_member_removal_blocked',not has_function_privilege('anon','public.remove_member(uuid,uuid)','EXECUTE'),
 'anonymous_claim_blocked',not has_function_privilege('anon','public.claim_invitations()','EXECUTE'),
 'anonymous_language_update_blocked',not has_function_privilege('anon','public.set_language(text)','EXECUTE'),
 'anonymous_approval_backfill_blocked',not has_function_privilege('anon','public.backfill_review_approvals()','EXECUTE')
);
