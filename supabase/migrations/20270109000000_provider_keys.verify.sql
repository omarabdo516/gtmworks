-- A Company's provider key (#124): the Company's Engine profiles are named to its signed-in members only; only the
-- Owner records a key change, which nobody writes by hand, which names a provider and holds no key, and which reaches
-- the log beside the other changes of the Company.
select json_build_object(
 'profiles_signed_in_only',has_function_privilege('authenticated','public.company_key_profiles(uuid)','execute')
  and not has_function_privilege('anon','public.company_key_profiles(uuid)','execute') and not has_function_privilege('service_role','public.company_key_profiles(uuid)','execute'),
 'profiles_members_only',position('is_member(c)' in pg_get_functiondef('public.company_key_profiles(uuid)'::regprocedure))>0
  and position('company_profiles' in pg_get_functiondef('public.company_key_profiles(uuid)'::regprocedure))>0,
 'record_signed_in_only',has_function_privilege('authenticated','public.record_provider_key_change(uuid,text,boolean)','execute')
  and not has_function_privilege('anon','public.record_provider_key_change(uuid,text,boolean)','execute')
  and not has_function_privilege('service_role','public.record_provider_key_change(uuid,text,boolean)','execute'),
 'record_as_owner',(select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.record_provider_key_change(uuid,text,boolean)'::regprocedure)
  and position('is_company_owner(c)' in pg_get_functiondef('public.record_provider_key_change(uuid,text,boolean)'::regprocedure))>0,
 'audit_closed',not has_table_privilege('authenticated','public.company_audit','insert') and not has_table_privilege('service_role','public.company_audit','insert'),
 'no_key_column',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_audit' and column_name ~ '(key|secret|value)'),
 'keys_logged',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_action_check')) like '%subscription_disconnected%provider_key_set%provider_key_removed%'
  and (select bool_and(position(t in pg_get_functiondef('public.log_company_change()'::regprocedure))>0) from unnest(array['provider_key_set','provider_key_removed','subscription_connected','agent_level_changed','company_knowledge_changed','app_connected','old_name']) t),
 'unfinished_closed',not has_table_privilege('authenticated','public.company_key_unfinished','select') and not has_table_privilege('authenticated','public.company_key_unfinished','insert')
  and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_key_unfinished' and column_name ~ '(key|secret|value)')
);
