-- #620: each Provider's model switches are read by the Company's Members and written only through the Owner's function.
select json_build_object(
 'rls',(select relrowsecurity from pg_class where oid='public.company_provider_models'::regclass),
 'members_read',has_table_privilege('authenticated','public.company_provider_models','select')
  and not has_table_privilege('authenticated','public.company_provider_models','insert')
  and not has_table_privilege('authenticated','public.company_provider_models','update')
  and not has_table_privilege('authenticated','public.company_provider_models','delete')
  and not has_table_privilege('anon','public.company_provider_models','select'),
 'owner_function',has_function_privilege('authenticated','public.set_provider_model(uuid,text,text,boolean)','execute')
  and not has_function_privilege('anon','public.set_provider_model(uuid,text,text,boolean)','execute'),
 'one_switch_a_model',exists(select 1 from pg_constraint where conrelid='public.company_provider_models'::regclass and contype='p')
);
