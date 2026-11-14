select json_build_object(
 'log_rls',(select relrowsecurity from pg_class where oid='public.company_log'::regclass),
 'members_read_own_company',exists(select 1 from pg_policies where schemaname='public' and tablename='company_log' and policyname='company_log_read' and cmd='SELECT' and qual like '%is_member(company_id)%'),
 'append_only',exists(select 1 from pg_trigger where tgrelid='public.company_log'::regclass and tgname='company_log_append_only'),
 'no_role_writes',not has_table_privilege('authenticated','public.company_log','insert') and not has_table_privilege('authenticated','public.company_log','update')
  and not has_table_privilege('authenticated','public.company_log','delete') and not has_table_privilege('authenticated','public.company_log','truncate')
  and not has_table_privilege('service_role','public.company_log','delete') and not has_table_privilege('service_role','public.company_log','update')
  and not has_table_privilege('anon','public.company_log','select'),
 'copying_triggers',(select count(*) from pg_trigger where tgname in ('work_activity_company_log','work_comments_company_log','member_audit_company_log','hermes_agent_audit_company_log'))=4,
 'functions_closed',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('refuse_log_change','log_actor_kind','log_member_details','log_member_action','log_agent_action','log_card_activity','log_card_comment','log_member_change','log_agent_change')
  and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))),
 -- Every Card comment is in the log as a note, with its original author, time and text.
 'comments_migrated',not exists(select 1 from public.work_comments c where not exists(select 1 from public.company_log l where l.source='work_comments' and l.source_id=c.id
  and l.company_id=c.company_id and l.card_id=c.card_id and l.action='note' and l.body=c.body and l.actor_id is not distinct from c.author_id and l.created_at=c.created_at)),
 -- Every other Card activity row is in the log with its original actor, action and time.
 'activity_migrated',not exists(select 1 from public.work_activity a where a.action<>'comment_added' and not exists(select 1 from public.company_log l where l.source='work_activity'
  and l.source_id=a.id and l.company_id=a.company_id and l.card_id=a.card_id and l.action=a.action and l.actor_id is not distinct from a.actor_id and l.created_at=a.created_at)),
 'comments_logged_once',not exists(select 1 from public.company_log l join public.work_activity a on l.source='work_activity' and l.source_id=a.id where a.action='comment_added'),
 'member_changes_migrated',not exists(select 1 from public.member_audit m where not exists(select 1 from public.company_log l where l.source='member_audit' and l.source_id=m.id
  and l.company_id=m.company_id and l.person_id=m.person_id and l.actor_id is not distinct from m.actor_id and l.created_at=m.created_at)),
 'agent_changes_migrated',not exists(select 1 from public.hermes_agent_audit h where not exists(select 1 from public.company_log l where l.source='hermes_agent_audit' and l.source_id=h.id
  and l.company_id=h.company_id and l.agent_id=h.agent_id and l.actor_id=h.actor_id and l.created_at=h.created_at))
);
