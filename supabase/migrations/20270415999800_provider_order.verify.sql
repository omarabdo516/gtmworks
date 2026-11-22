-- The Providers' order and switches (#619): members read them under row-level security, nobody writes the table by
-- hand, and only the Owner orders or switches a Provider, through functions that check the Owner themselves.
select json_build_object(
 'order_rls',(select relrowsecurity from pg_class where oid='public.provider_order'::regclass),
 'order_members_read',has_table_privilege('authenticated','public.provider_order','select')
  and (select bool_and(position('is_member(company_id)' in pg_get_expr(polqual,polrelid))>0) from pg_policy where polrelid='public.provider_order'::regclass),
 'order_closed',not has_table_privilege('authenticated','public.provider_order','insert') and not has_table_privilege('authenticated','public.provider_order','update')
  and not has_table_privilege('authenticated','public.provider_order','delete') and not has_table_privilege('anon','public.provider_order','select')
  and not has_table_privilege('service_role','public.provider_order','insert'),
 'order_signed_in_only',has_function_privilege('authenticated','public.order_providers(uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.order_providers(uuid,jsonb)','execute')
  and has_function_privilege('authenticated','public.switch_provider(uuid,text,text,boolean)','execute')
  and not has_function_privilege('anon','public.switch_provider(uuid,text,text,boolean)','execute'),
 'forget_signed_in_only',has_function_privilege('authenticated','public.forget_provider(uuid,text,text)','execute')
  and not has_function_privilege('anon','public.forget_provider(uuid,text,text)','execute'),
 'order_as_owner',(select bool_and(prosecdef and proconfig @> array['search_path=""'] and position('is_company_owner(c)' in pg_get_functiondef(oid))>0)
  from pg_proc where oid in ('public.order_providers(uuid,jsonb)'::regprocedure,'public.switch_provider(uuid,text,text,boolean)'::regprocedure,
   'public.forget_provider(uuid,text,text)'::regprocedure))
);
