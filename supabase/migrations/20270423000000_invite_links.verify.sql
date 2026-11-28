-- #950: an Invite link is read by no role of the app but the server's, an Administrator role is refused by the table
-- itself, an Administrator asks to make one, and only the server opens and spends it, locking it first.
select json_build_object(
 'row_level_security',(select bool_and(relrowsecurity) from pg_class where oid in ('public.company_links'::regclass,'public.company_link_agents'::regclass)),
 'no_member_reaches_a_link',not has_table_privilege('authenticated','public.company_links','select,insert,update,delete')
  and not has_table_privilege('anon','public.company_links','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.company_link_agents','select,insert,update,delete')
  and not has_table_privilege('anon','public.company_link_agents','select,insert,update,delete'),
 'one_secret_column_its_hash',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='company_links' and column_name in ('secret','code','token')),
 'no_administrator_link',exists(select 1 from pg_constraint where conrelid='public.company_links'::regclass and contype='c' and pg_get_constraintdef(oid) like '%role%manager%contributor%viewer%')
  and not exists(select 1 from pg_constraint where conrelid='public.company_links'::regclass and contype='c' and pg_get_constraintdef(oid) like '%owner%'),
 'administrator_makes',has_function_privilege('authenticated','public.make_invite_link(uuid,text,text,uuid[],text)','execute')
  and not has_function_privilege('anon','public.make_invite_link(uuid,text,text,uuid[],text)','execute')
  and position('is_company_owner' in pg_get_functiondef('public.make_invite_link(uuid,text,text,uuid[],text)'::regprocedure))>0,
 'server_opens_and_spends',(select bool_and(has_function_privilege('service_role',fn,'execute') and not has_function_privilege('authenticated',fn,'execute') and not has_function_privilege('anon',fn,'execute'))
  from unnest(array['public.invite_link_open(text)','public.claim_invite_link(text,uuid,text,text)']) fn),
 'claim_locks_first',pg_get_functiondef('public.claim_invite_link(text,uuid,text,text)'::regprocedure) ~ 'secret_hash=link_hash[^;]*for update',
 'made_and_used_logged',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_log'::regclass and conname='company_log_source_check')) like '%company_links%'
  and not has_sequence_privilege('authenticated','public.company_link_log_seq','usage')
);
