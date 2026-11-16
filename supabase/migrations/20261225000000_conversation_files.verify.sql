select json_build_object(
 'conversation_files_have_row_level_security',(select relrowsecurity from pg_class where oid='public.conversation_attachments'::regclass),
 'anonymous_visitors_reach_nothing',not has_table_privilege('anon','public.conversation_attachments','select'),
 'signed_in_people_only_read',has_table_privilege('authenticated','public.conversation_attachments','select') and not has_table_privilege('authenticated','public.conversation_attachments','insert')
  and not has_table_privilege('authenticated','public.conversation_attachments','update') and not has_table_privilege('authenticated','public.conversation_attachments','delete'),
 'only_the_conversations_person_reads',exists(select 1 from pg_policies where schemaname='public' and tablename='conversation_attachments' and policyname='conversation_attachments_read' and cmd='SELECT'
  and qual like '%person_id = auth.uid()%' and qual like '%can_see_agent%'),
 'no_policy_writes_them',not exists(select 1 from pg_policies where schemaname='public' and tablename='conversation_attachments' and cmd<>'SELECT'),
 'a_path_stays_in_its_company_folder',exists(select 1 from pg_constraint where conrelid='public.conversation_attachments'::regclass and contype='c' and pg_get_constraintdef(oid) like '%split_part%'),
 'a_file_belongs_to_a_conversation_of_its_company',exists(select 1 from pg_constraint where conrelid='public.conversation_attachments'::regclass and contype='f' and confrelid='public.conversations'::regclass and array_length(conkey,1)=2),
 'company_rules_skip_the_conversations_folder',(select bool_and(coalesce(qual,with_check) like '%conversations%') from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('creative_read','creative_write')),
 'only_the_conversations_person_reads_its_bytes',exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='conversation_file_read' and cmd='SELECT' and qual like '%person_id = auth.uid()%' and qual like '%can_see_agent%'),
 'a_file_is_named_once_per_company',exists(select 1 from pg_constraint where conrelid='public.conversation_attachments'::regclass and contype='u' and pg_get_constraintdef(oid) like '%company_id, path%')
);
