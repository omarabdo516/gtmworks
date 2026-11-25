begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select ok(not has_function_privilege('anon','public.is_member(uuid)','EXECUTE'),'anonymous member lookup blocked');
select ok(not has_function_privilege('anon','public.remove_member(uuid,uuid)','EXECUTE'),'anonymous member removal blocked');
select ok(not has_function_privilege('anon','public.claim_invitations()','EXECUTE'),'anonymous invitation claiming blocked');
select ok(not has_function_privilege('anon','public.set_language(text)','EXECUTE'),'anonymous language update blocked');
-- The approval backfill went with approval steps (#684); the review that replaced them is closed to anonymous callers.
select ok(not has_function_privilege('anon','public.decide_review(uuid,bigint,bigint,text,text)','EXECUTE'),'anonymous review decision blocked');

select ok(has_function_privilege('authenticated','public.is_member(uuid)','EXECUTE'),'authenticated member lookup preserved');
select ok(has_function_privilege('authenticated','public.remove_member(uuid,uuid)','EXECUTE'),'authenticated member removal preserved');
select ok(has_function_privilege('authenticated','public.claim_invitations()','EXECUTE'),'authenticated invitation claiming preserved');
select ok(has_function_privilege('authenticated','public.set_language(text)','EXECUTE'),'authenticated language update preserved');
select ok(to_regprocedure('public.backfill_review_approvals()') is null,'the approval backfill is gone');
select * from finish();
rollback;
