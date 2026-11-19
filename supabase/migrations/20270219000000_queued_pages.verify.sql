-- Queued turns page through every waiting Conversation (#68): a stable cursor pages by Conversation id beside the previous
-- app version's one-argument call, which is kept, and both answer with the one `conversation` column.
select json_build_object(
 'cursor_argument',(select p.proargnames[1:2]=array['just','after'] and p.pronargdefaults=0
  from pg_proc p where p.oid='public.queued_conversations(uuid,uuid)'::regprocedure),
 'previous_call_kept',to_regprocedure('public.queued_conversations(uuid)') is not null,
 'one_column_kept',(select pg_get_function_result(p.oid)='TABLE(conversation uuid)'
  from pg_proc p where p.oid='public.queued_conversations(uuid,uuid)'::regprocedure),
 'service_role_only',has_function_privilege('service_role','public.queued_conversations(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.queued_conversations(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.queued_conversations(uuid,uuid)','execute')
);
