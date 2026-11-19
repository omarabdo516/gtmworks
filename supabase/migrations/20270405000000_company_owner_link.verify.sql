-- #383: a first-Owner link keeps only its secret's hash, one link per waiting Engine, and only server code reads links or
-- makes the Company a link names.
select json_build_object(
 'link_table',to_regclass('public.company_owner_links') is not null,
 'link_columns',(select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema='public' and table_name='company_owner_links')=array['claimed_at','company_name','created_at','engine_id','id','secret_hash'],
 'link_is_private',not has_table_privilege('anon','public.company_owner_links','select')
  and not has_table_privilege('authenticated','public.company_owner_links','select')
  and has_table_privilege('service_role','public.company_owner_links','select'),
 'one_link_per_engine',exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
  where i.indrelid='public.company_owner_links'::regclass and i.indisunique and a.attname='engine_id'),
 'maker_is_private',not has_function_privilege('anon','public.create_company_with_owner(uuid,text,uuid,text,text,text)','execute')
  and not has_function_privilege('authenticated','public.create_company_with_owner(uuid,text,uuid,text,text,text)','execute')
  and has_function_privilege('service_role','public.create_company_with_owner(uuid,text,uuid,text,text,text)','execute'),
 'claim_is_private',not has_function_privilege('anon','public.claim_company_owner_link(text,uuid,text,text)','execute')
  and not has_function_privilege('authenticated','public.claim_company_owner_link(text,uuid,text,text)','execute')
  and has_function_privilege('service_role','public.claim_company_owner_link(text,uuid,text,text)','execute')
);
