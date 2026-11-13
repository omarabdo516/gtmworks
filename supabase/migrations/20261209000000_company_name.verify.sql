-- Only a signed-in person may call the rename, it runs as its owner with an empty search path, and it checks the
-- Owner itself; companies still have no update policy of their own.
select json_build_object(
 'signed_in_only',has_function_privilege('authenticated','public.rename_company(uuid,text)','execute')
  and not has_function_privilege('anon','public.rename_company(uuid,text)','execute')
  and not has_function_privilege('service_role','public.rename_company(uuid,text)','execute'),
 'runs_as_owner',(select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.rename_company(uuid,text)'::regprocedure),
 'checks_the_owner',position('is_company_owner' in pg_get_functiondef('public.rename_company(uuid,text)'::regprocedure))>0,
 'no_update_policy',not exists(select 1 from pg_policies where schemaname='public' and tablename='companies' and cmd in ('UPDATE','ALL'))
);
