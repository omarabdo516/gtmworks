-- The Providers' names (#618): members read them under row-level security, nobody writes the table by hand, and only
-- the Owner names a Provider through rename_provider, which checks the Owner itself.
select json_build_object(
 'names_rls',(select relrowsecurity from pg_class where oid='public.provider_names'::regclass),
 'names_members_read',has_table_privilege('authenticated','public.provider_names','select')
  and (select bool_and(position('is_member(company_id)' in pg_get_expr(polqual,polrelid))>0) from pg_policy where polrelid='public.provider_names'::regclass),
 'names_closed',not has_table_privilege('authenticated','public.provider_names','insert') and not has_table_privilege('authenticated','public.provider_names','update')
  and not has_table_privilege('authenticated','public.provider_names','delete') and not has_table_privilege('anon','public.provider_names','select')
  and not has_table_privilege('service_role','public.provider_names','insert'),
 'rename_signed_in_only',has_function_privilege('authenticated','public.rename_provider(uuid,text,text,text)','execute')
  and not has_function_privilege('anon','public.rename_provider(uuid,text,text,text)','execute')
  and not has_function_privilege('service_role','public.rename_provider(uuid,text,text,text)','execute'),
 'rename_as_owner',(select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.rename_provider(uuid,text,text,text)'::regprocedure)
  and position('is_company_owner(c)' in pg_get_functiondef('public.rename_provider(uuid,text,text,text)'::regprocedure))>0
);
