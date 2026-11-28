-- #954: a password link is read by no role of the app but the server's, it names its Member and gives no Role, an
-- Administrator or a Manager asks to make one (a Manager never for an Administrator), and only the server opens and
-- spends it, locking it first and ending the Member's sessions.
select json_build_object(
 'two_kinds',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_links'::regclass and conname='company_links_kind_check')) like '%invite%password%',
 'password_link_names_its_member',exists(select 1 from pg_constraint where conrelid='public.company_links'::regclass and conname='company_links_password_check'),
 'no_member_reaches_a_link',not has_table_privilege('authenticated','public.company_links','select,insert,update,delete'),
 'administrator_or_manager_makes',has_function_privilege('authenticated','public.make_password_link(uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.make_password_link(uuid,uuid,text)','execute')
  and position($$target='owner' and asker<>'owner'$$ in pg_get_functiondef('public.make_password_link(uuid,uuid,text)'::regprocedure))>0,
 'server_opens_and_spends',(select bool_and(has_function_privilege('service_role',fn,'execute') and not has_function_privilege('authenticated',fn,'execute') and not has_function_privilege('anon',fn,'execute'))
  from unnest(array['public.password_link_open(text)','public.claim_password_link(text)']) fn),
 'claim_locks_first',pg_get_functiondef('public.claim_password_link(text)'::regprocedure) ~ 'secret_hash=link_hash[^;]*for update',
 'claim_ends_sessions',position('delete from auth.sessions' in pg_get_functiondef('public.claim_password_link(text)'::regprocedure))>0
);
