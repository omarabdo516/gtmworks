-- #384, ADR 0018 (Sign-in): the sign-in target answers the Company's profiles in one order on every database. Its
-- definition puts the Company's own profile ahead of its Agents' (x.own desc), then names them, and still shows a
-- Member's Company only.
select json_build_object(
 'target_own_profile_first',position('orderbyx.owndesc,x.profile' in regexp_replace(pg_get_functiondef('public.company_engine_target(uuid)'::regprocedure),'[[:space:]]','','g'))>0,
 'target_members_only',position('is_member(c)' in pg_get_functiondef('public.company_engine_target(uuid)'::regprocedure))>0,
 'target_signed_in_only',has_function_privilege('authenticated','public.company_engine_target(uuid)','execute')
  and not has_function_privilege('anon','public.company_engine_target(uuid)','execute') and not has_function_privilege('service_role','public.company_engine_target(uuid)','execute')
);
