select json_build_object(
 'note_edit_time',exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_comments' and column_name='edited_at'),
 'note_edit_guarded',exists(select 1 from pg_trigger where tgrelid='public.work_comments'::regclass and tgname='work_comments_note_edit' and tgenabled='O'),
 'note_time_stamped',exists(select 1 from pg_trigger where tgrelid='public.work_comments'::regclass and tgname='work_comments_note_time' and tgenabled='O'),
 'notes_never_deleted',exists(select 1 from pg_trigger where tgrelid='public.work_comments'::regclass and tgname='work_comments_never_deleted' and tgenabled='O'),
 'comment_activity_once',(select tgtype & 28 = 4 from pg_trigger where tgrelid='public.work_comments'::regclass and tgname='work_audit'),
 'log_follows_edit',exists(select 1 from pg_trigger where tgrelid='public.work_comments'::regclass and tgname='work_comments_log_edit' and tgenabled='O'),
 'mentions_read',exists(select 1 from pg_trigger where tgrelid='public.work_comments'::regclass and tgname='work_comments_mentions' and tgenabled='O'),
 'one_item_per_note',exists(select 1 from pg_indexes where schemaname='public' and tablename='waiting_items' and indexname='waiting_items_one_per_note'),
 'item_opens_the_note',has_column_privilege('authenticated','public.waiting_items','note_id','select'),
 'log_takes_note_replies',pg_get_constraintdef((select oid from pg_constraint where conrelid='public.company_log'::regclass and conname='company_log_source_check')) like '%note_runs%',
 'note_runs_rls',(select relrowsecurity from pg_class where oid='public.note_runs'::regclass),
 'no_client_table_writes',not has_table_privilege('authenticated','public.note_runs','insert,update,delete,truncate')
  and not has_table_privilege('anon','public.note_runs','select,insert,update,delete'),
 'run_state_only',has_column_privilege('authenticated','public.note_runs','outcome','select')
  and not has_column_privilege('authenticated','public.note_runs','input','select')
  and not has_column_privilege('authenticated','public.note_runs','instructions','select')
  and not has_column_privilege('authenticated','public.note_runs','connection_id','select')
  and not has_column_privilege('authenticated','public.note_runs','run_id','select')
  and not has_column_privilege('authenticated','public.note_runs','reply','select'),
 'lifecycle_service_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.note_runs_due(bigint,bigint)','public.begin_note_start(bigint)','public.answer_note_start(bigint,integer,text)','public.close_note_run(bigint,text,text,text,bigint,bigint)']) f),
 'internals_uncallable',(select bool_and(not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.guard_note_edit()','public.stamp_note_time()','public.refuse_note_delete()','public.log_note_edit()','public.mention_at(text,text)','public.note_mentions()']) f),
 'members_edit_and_list',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.edit_card_note(uuid,bigint,text)','public.waiting_list(uuid)']) f),
 'move_waits_for_note_runs',position('note_runs' in pg_get_functiondef('public.move_company_profile(uuid,text,text,text,text[])'::regprocedure))>0,
 'usage_counts_note_runs',position('note_runs' in pg_get_functiondef('public.usage_by_day()'::regprocedure))>0
);
