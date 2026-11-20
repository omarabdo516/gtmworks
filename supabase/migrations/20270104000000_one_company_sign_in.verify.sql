-- One Company's sign-in (#123): the sign-in target stays for members only and names the Company's own profiles; only
-- the Owner records a subscription change, which nobody writes by hand, which a finished sign-in records once, and which
-- reaches the log beside the other changes of the Company. #384 removed what the file checked about the install's
-- Company count and the target's one_company column, because a Company signs in on its own Engine's root profile now.
select json_build_object(
 'target_signed_in_only',has_function_privilege('authenticated','public.company_engine_target(uuid)','execute')
  and not has_function_privilege('anon','public.company_engine_target(uuid)','execute') and not has_function_privilege('service_role','public.company_engine_target(uuid)','execute'),
 'target_members_only',position('is_member(c)' in pg_get_functiondef('public.company_engine_target(uuid)'::regprocedure))>0,
 'target_names_profiles',(select proargnames @> array['profile','profiles'] from pg_proc where oid='public.company_engine_target(uuid)'::regprocedure),
 'record_signed_in_only',has_function_privilege('authenticated','public.record_subscription_change(uuid,text,boolean,text)','execute')
  and not has_function_privilege('anon','public.record_subscription_change(uuid,text,boolean,text)','execute')
  and not has_function_privilege('service_role','public.record_subscription_change(uuid,text,boolean,text)','execute'),
 'record_as_owner',(select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.record_subscription_change(uuid,text,boolean,text)'::regprocedure)
  and position('is_company_owner(c)' in pg_get_functiondef('public.record_subscription_change(uuid,text,boolean,text)'::regprocedure))>0,
 'audit_closed',not has_table_privilege('authenticated','public.company_audit','insert') and not has_table_privilege('service_role','public.company_audit','insert'),
 'one_row_per_sign_in',(select indisunique and pg_get_expr(indpred,indrelid) like '%sign_in_session IS NOT NULL%' from pg_index where indexrelid='public.company_audit_sign_in_session'::regclass),
 'subscriptions_logged',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_action_check')) like '%subscription_connected%subscription_disconnected%'
  and (select bool_and(position(t in pg_get_functiondef('public.log_company_change()'::regprocedure))>0) from unnest(array['subscription_connected','agent_level_changed','company_knowledge_changed','app_connected','old_name']) t)
);
