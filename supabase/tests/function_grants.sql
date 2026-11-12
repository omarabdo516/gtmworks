begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select ok(not has_function_privilege('anon','public.is_member(uuid)','EXECUTE'),'anonymous member lookup blocked');
select ok(not has_function_privilege('anon','public.remove_member(uuid,uuid)','EXECUTE'),'anonymous member removal blocked');
select ok(not has_function_privilege('anon','public.claim_invitations()','EXECUTE'),'anonymous invitation claiming blocked');
select ok(not has_function_privilege('anon','public.set_language(text)','EXECUTE'),'anonymous language update blocked');
select ok(not has_function_privilege('anon','public.lookup_agent_key(text)','EXECUTE'),'anonymous agent key lookup blocked');
select ok(not has_function_privilege('anon','public.log_agent_refusal(uuid,uuid,text)','EXECUTE'),'anonymous agent refusal logging blocked');
select ok(not has_function_privilege('anon','public.agent_rate_limit(uuid)','EXECUTE'),'anonymous agent rate limit blocked');
select ok(not has_function_privilege('anon','public.claim_webhook_deliveries()','EXECUTE'),'anonymous webhook claiming blocked');
select ok(not has_function_privilege('anon','public.backfill_review_approvals()','EXECUTE'),'anonymous approval backfill blocked');

select ok(has_function_privilege('authenticated','public.is_member(uuid)','EXECUTE'),'authenticated member lookup preserved');
select ok(has_function_privilege('authenticated','public.remove_member(uuid,uuid)','EXECUTE'),'authenticated member removal preserved');
select ok(has_function_privilege('authenticated','public.claim_invitations()','EXECUTE'),'authenticated invitation claiming preserved');
select ok(has_function_privilege('authenticated','public.set_language(text)','EXECUTE'),'authenticated language update preserved');
select ok(has_function_privilege('authenticated','public.log_agent_refusal(uuid,uuid,text)','EXECUTE'),'authenticated agent refusal logging preserved');
select ok(not has_function_privilege('authenticated','public.lookup_agent_key(text)','EXECUTE'),'authenticated agent key lookup stays blocked');
select ok(not has_function_privilege('authenticated','public.agent_rate_limit(uuid)','EXECUTE'),'authenticated agent rate limit stays blocked');
select ok(not has_function_privilege('authenticated','public.claim_webhook_deliveries()','EXECUTE'),'authenticated webhook claiming stays blocked');
select ok(not has_function_privilege('authenticated','public.backfill_review_approvals()','EXECUTE'),'authenticated approval backfill stays blocked');
select ok(has_function_privilege('service_role','public.lookup_agent_key(text)','EXECUTE'),'service agent key lookup preserved');
select ok(has_function_privilege('service_role','public.agent_rate_limit(uuid)','EXECUTE'),'service agent rate limit preserved');
select ok(has_function_privilege('service_role','public.claim_webhook_deliveries()','EXECUTE'),'service webhook claiming preserved');
select * from finish();
rollback;
