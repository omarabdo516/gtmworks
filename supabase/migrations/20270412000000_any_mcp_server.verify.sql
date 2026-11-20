-- The sign-in table and the three app writers accept the Engine's underscored catalogue name and a made server's hyphens,
-- run as the owner with an empty search path, and only a signed-in person reaches them; each checks the Owner and the
-- Agent, and a made server's turn-on is in the same activity list as a finished sign-in.
select json_build_object(
 'keys_widened',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_app_sign_ins'::regclass and conname='company_app_sign_ins_app_check')) like '%a-z0-9_-%',
 'connect_keys_widened',position('a-z0-9_-' in pg_get_functiondef('public.reply_card_valid(text,text,jsonb)'::regprocedure))>0,
 'signed_in_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.start_app_sign_in(uuid,text,text,uuid)','public.record_app_disconnected(uuid,text,uuid)','public.record_app_connected(uuid,text,uuid)']) f),
 'run_as_owner',(select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.start_app_sign_in(uuid,text,text,uuid)'::regprocedure,'public.record_app_disconnected(uuid,text,uuid)'::regprocedure,'public.record_app_connected(uuid,text,uuid)'::regprocedure)),
 'check_the_owner',(select bool_and(position('is_company_owner' in pg_get_functiondef(f::regprocedure))>0 and position('a-z0-9_-' in pg_get_functiondef(f::regprocedure))>0)
  from unnest(array['public.start_app_sign_in(uuid,text,text,uuid)','public.record_app_disconnected(uuid,text,uuid)','public.record_app_connected(uuid,text,uuid)']) f),
 'agent_checked',position('appsAgentNotOwn' in pg_get_functiondef('public.record_app_connected(uuid,text,uuid)'::regprocedure))>0,
 'connected_logged',exists(select 1 from pg_constraint where conrelid='public.company_audit'::regclass and conname='company_audit_action_check' and pg_get_constraintdef(oid) like '%app_connected%')
);