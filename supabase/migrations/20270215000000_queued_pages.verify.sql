-- Queued turns page through every waiting Conversation (#68): a stable cursor pages by Conversation id, and the previous
-- app version's one-argument call still answers with its one `conversation` column.
select json_build_object(
 'cursor_argument',(select p.proargnames=array['just','after'] and p.pronargdefaults=2
  from pg_proc p where p.oid='public.queued_conversations(uuid,uuid)'::regprocedure),
 'one_signature',to_regprocedure('public.queued_conversations(uuid)') is null,
 'one_column_kept',(select pg_get_function_result(p.oid)='TABLE(conversation uuid)'
  from pg_proc p where p.oid='public.queued_conversations(uuid,uuid)'::regprocedure),
 'service_role_only',has_function_privilege('service_role','public.queued_conversations(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.queued_conversations(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.queued_conversations(uuid,uuid)','execute')
);
