select json_build_object(
 'owner_asks',has_function_privilege('authenticated','public.bundled_engine_shared(uuid)','execute') and not has_function_privilege('anon','public.bundled_engine_shared(uuid)','execute'),
 -- The Owner check moved into is_company_owner (20261204000000_remove_agency, ADR 0012): the notice asks it, and it
 -- requires an active Owner Member.
 'owner_only',position('is_company_owner(c)' in pg_get_functiondef('public.bundled_engine_shared(uuid)'::regprocedure))>0
  and position('role=''owner''' in replace(pg_get_functiondef('public.is_company_owner(uuid)'::regprocedure),' ',''))>0
  and position('removed_atisnull' in replace(pg_get_functiondef('public.is_company_owner(uuid)'::regprocedure),' ',''))>0
);
