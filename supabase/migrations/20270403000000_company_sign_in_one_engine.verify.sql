-- #384, ADR 0018: the install no longer asks whether it has one Company or several, and nothing warns that two
-- Companies share an Engine. The sign-in target stays for a Company's Members only and names that Company's profiles.
select json_build_object(
 'one_company_gone',to_regprocedure('public.install_has_one_company()') is null,
 'shared_engine_gone',to_regprocedure('public.bundled_engine_shared(uuid)') is null,
 'target_signed_in_only',has_function_privilege('authenticated','public.company_engine_target(uuid)','execute')
  and not has_function_privilege('anon','public.company_engine_target(uuid)','execute') and not has_function_privilege('service_role','public.company_engine_target(uuid)','execute'),
 'target_members_only',position('is_member(c)' in pg_get_functiondef('public.company_engine_target(uuid)'::regprocedure))>0,
 'target_names_profiles',(select proargnames @> array['profile','profiles'] and not proargnames @> array['one_company'] from pg_proc where oid='public.company_engine_target(uuid)'::regprocedure)
);
