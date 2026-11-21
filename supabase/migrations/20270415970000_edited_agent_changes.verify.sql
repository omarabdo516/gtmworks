-- #484: an Owner's edit is kept beside what the Agent proposed, only through a claim, only as a valid value of the same
-- change; the previous app's claim still approves as proposed, and the edit is logged with the approval.
select json_build_object(
 'edit_kept_beside_proposal',exists(select 1 from pg_attribute where attrelid='public.agent_change_proposals'::regclass and attname='approved_value' and not attisdropped)
  and exists(select 1 from pg_constraint where conrelid='public.agent_change_proposals'::regclass and conname='agent_change_proposals_approved_value')
  and position('agent_change_value_valid' in (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.agent_change_proposals'::regclass and conname='agent_change_proposals_approved_value'))>0,
 'owner_claims_an_edit',has_function_privilege('authenticated','public.claim_agent_change(uuid,bigint,jsonb)','execute')
  and not has_function_privilege('anon','public.claim_agent_change(uuid,bigint,jsonb)','execute')
  and not has_function_privilege('service_role','public.claim_agent_change(uuid,bigint,jsonb)','execute')
  and position('agentChangeEditInvalid' in pg_get_functiondef('public.claim_agent_change(uuid,bigint,jsonb)'::regprocedure))>0,
 'previous_claim_as_proposed',has_function_privilege('authenticated','public.claim_agent_change(uuid,bigint)','execute')
  and position('null::jsonb' in pg_get_functiondef('public.claim_agent_change(uuid,bigint)'::regprocedure))>0,
 'edit_logged',position('approved_value' in pg_get_functiondef('public.answer_agent_change(uuid,bigint,boolean,text,uuid)'::regprocedure))>0
  and position('approved_value' in pg_get_functiondef('public.release_agent_change(uuid,bigint,uuid,boolean)'::regprocedure))>0
);
