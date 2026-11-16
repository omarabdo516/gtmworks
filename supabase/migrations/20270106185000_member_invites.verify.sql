select json_build_object(
 'invited_switches_read_only',(select relrowsecurity from pg_class where oid='public.invitation_agent_access'::regclass)
  and has_table_privilege('authenticated','public.invitation_agent_access','select')
  and not has_table_privilege('authenticated','public.invitation_agent_access','insert,update,delete')
  and not has_table_privilege('anon','public.invitation_agent_access','select,insert,update,delete')
  and not has_table_privilege('service_role','public.invitation_agent_access','select,insert,update,delete'),
 'changed_by_people',(select bool_and(has_function_privilege('authenticated',fn,'execute') and not has_function_privilege('anon',fn,'execute') and not has_function_privilege('service_role',fn,'execute'))
  from unnest(array['public.set_invitation_agent_visible(uuid,uuid,uuid,boolean)','public.invite_member(uuid,text,public.member_role)']) fn),
 'claim_kept',has_function_privilege('authenticated','public.claim_invitations()','execute') and not has_function_privilege('anon','public.claim_invitations()','execute')
  and position('invitation_agent_access' in pg_get_functiondef('public.claim_invitations()'::regprocedure))>0,
 'every_invitation_logged',(select count(*)=2 from pg_trigger where tgfoid='public.log_member_invitation()'::regprocedure and tgrelid='public.member_invitations'::regclass and not tgisinternal)
  and pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_log'::regclass and conname='company_log_source_check')) like '%member_invitations%'
  and not has_sequence_privilege('authenticated','public.member_invitation_log_seq','usage')
);
