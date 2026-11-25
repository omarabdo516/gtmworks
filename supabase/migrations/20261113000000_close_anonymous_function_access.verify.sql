select json_build_object(
 'anonymous_member_lookup_blocked',not has_function_privilege('anon','public.is_member(uuid)','EXECUTE'),
 'anonymous_member_removal_blocked',not has_function_privilege('anon','public.remove_member(uuid,uuid)','EXECUTE'),
 'anonymous_claim_blocked',not has_function_privilege('anon','public.claim_invitations()','EXECUTE'),
 'anonymous_language_update_blocked',not has_function_privilege('anon','public.set_language(text)','EXECUTE'),
 -- The approval backfill went with approval steps (#684); the review that replaced them is closed to anonymous callers too.
 'anonymous_approval_backfill_blocked',to_regprocedure('public.backfill_review_approvals()') is null and not has_function_privilege('anon','public.decide_review(uuid,bigint,bigint,text,text)','EXECUTE')
);
