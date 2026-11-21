-- #166: a request keeps what an always answer keeps in the Engine, and both tracking functions keep it; who allowed an
-- entry is read only by the Agent's readers, a revoke is an Owner's or a Manager's, and the helpers are no one's to call.
select json_build_object(
 'allows_kept',exists(select 1 from pg_constraint where conrelid='public.reply_cards'::regclass and conname='reply_cards_allows')
  and exists(select 1 from pg_constraint where conrelid='public.channel_permissions'::regclass and conname='channel_permissions_allows')
  and position('permission_allows_of' in pg_get_functiondef('public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure))>0
  and position('permission_allows_of' in pg_get_functiondef('public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure))>0
  and public.permission_allows_valid(array['mcp:meta-ads/create_campaign']) and not public.permission_allows_valid(array[' padded']) and not public.permission_allows_valid('{}'),
 'grants_for_readers',position('can_see_agent' in pg_get_functiondef('public.agent_permission_grants(uuid,uuid)'::regprocedure))>0
  and has_function_privilege('authenticated','public.agent_permission_grants(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.agent_permission_grants(uuid,uuid)','execute'),
 'revoke_for_managers',position('can_manage_company' in pg_get_functiondef('public.check_permission_revoke(uuid,uuid)'::regprocedure))>0
  and position('check_permission_revoke' in pg_get_functiondef('public.log_permission_revoked(uuid,uuid,text,text)'::regprocedure))>0
  and has_function_privilege('authenticated','public.log_permission_revoked(uuid,uuid,text,text)','execute')
  and not has_function_privilege('anon','public.log_permission_revoked(uuid,uuid,text,text)','execute')
  and not has_function_privilege('service_role','public.log_permission_revoked(uuid,uuid,text,text)','execute')
  and position('check_permission_revoke' in pg_get_functiondef('public.agent_permission_inflight(uuid,uuid)'::regprocedure))>0
  and not has_function_privilege('anon','public.agent_permission_inflight(uuid,uuid)','execute'),
 'revoke_holds_delivery',(select relrowsecurity from pg_class where oid='public.agent_permission_revokes'::regclass)
  and not has_table_privilege('authenticated','public.agent_permission_revokes','select,insert,update,delete')
  and not has_table_privilege('service_role','public.agent_permission_revokes','select,insert,update,delete')
  and position('permission_revoke_held' in pg_get_functiondef('public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure))>0
  and position('permission_revoke_held' in pg_get_functiondef('public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure))>0
  and has_function_privilege('authenticated','public.begin_permission_revoke(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.begin_permission_revoke(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.permission_revoke_held(uuid)','execute'),
 'helpers_private',(select bool_and(not has_function_privilege(r,'public.permission_allows_of(jsonb,jsonb)','execute')
   and not has_function_privilege(r,'public.permission_allows_valid(text[])','execute')) from unnest(array['anon','authenticated','service_role']) r)
);
