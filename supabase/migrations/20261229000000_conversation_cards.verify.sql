select json_build_object(
 'card_tie_optional',(select not attnotnull from pg_attribute where attrelid='public.work_cards'::regclass and attname='conversation_id' and not attisdropped),
 'tie_same_company_kept_on_delete',(select confrelid='public.conversations'::regclass and confdeltype='n'
   and conkey=array[(select attnum from pg_attribute where attrelid='public.work_cards'::regclass and attname='conversation_id'),(select attnum from pg_attribute where attrelid='public.work_cards'::regclass and attname='company_id')]::int2[]
   and confdelsetcols=array[(select attnum from pg_attribute where attrelid='public.work_cards'::regclass and attname='conversation_id')]::int2[]
  from pg_constraint where conname='work_cards_conversation_fkey' and conrelid='public.work_cards'::regclass),
 'one_card_per_conversation',(select indisunique and pg_get_expr(indpred,indrelid) like '%conversation_id IS NOT NULL%' from pg_index where indexrelid='public.work_cards_one_per_conversation'::regclass),
 'reply_judged_at_commit',(select tgconstraint<>0 and tgdeferrable and tginitdeferred and tgenabled='O' from pg_trigger
  where tgrelid='public.conversation_messages'::regclass and tgname='conversation_reply_card'),
 'only_database_ties',exists(select 1 from pg_trigger where tgrelid='public.work_cards'::regclass and tgname='work_card_conversation_guard' and not tgisinternal),
 'internals_uncallable',(select bool_and(not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.chat_card_title(text,text)','public.conversation_reply_card()','public.guard_card_conversation()']) f),
 'members_ask_card_visibility',has_function_privilege('authenticated','public.can_see_card(uuid,bigint)','execute')
  and not has_function_privilege('anon','public.can_see_card(uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.can_see_card(uuid,bigint)','execute'),
 'tied_rows_follow_agent',(select count(*)=14 and bool_and(permissive='RESTRICTIVE' and cmd='SELECT' and roles=array['authenticated']::name[]) from pg_policies
  where schemaname='public' and policyname='card_agent_visible'
   and tablename in ('work_cards','work_checklist','work_card_labels','work_assignees','work_creatives','work_versions','work_comments','work_activity',
    'work_attachments','work_card_visits','note_runs','skill_lessons','waiting_items','company_log')),
 'tied_rows_take_no_hidden_writes',(select count(*)=13 and bool_and(permissive='RESTRICTIVE' and cmd='INSERT' and roles=array['authenticated']::name[]) from pg_policies
  where schemaname='public' and policyname='card_agent_visible_write'),
 'tied_files_follow_agent',(select count(*)=2 and bool_and(permissive='RESTRICTIVE' and roles=array['authenticated']::name[]) from pg_policies
  where schemaname='storage' and tablename='objects' and policyname in ('card_file_visible','card_file_visible_write'))
  and has_function_privilege('authenticated','public.can_see_card_file(text)','execute') and not has_function_privilege('anon','public.can_see_card_file(text)','execute'),
 'run_close_unchanged',position('work_cards' in pg_get_functiondef('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint)'::regprocedure))=0
);
