select json_build_object(
 'attachments_have_row_level_security',(select relrowsecurity from pg_class where oid='public.work_attachments'::regclass),
 'anonymous_visitors_reach_nothing',not has_table_privilege('anon','public.work_attachments','select') and not has_table_privilege('anon','public.work_attachments','insert'),
 'signed_in_people_read_and_attach_only',has_table_privilege('authenticated','public.work_attachments','select') and has_table_privilege('authenticated','public.work_attachments','insert') and not has_table_privilege('authenticated','public.work_attachments','update') and not has_table_privilege('authenticated','public.work_attachments','delete'),
 'a_path_stays_in_its_company_folder',exists(select 1 from pg_constraint where conrelid='public.work_attachments'::regclass and contype='c' and pg_get_constraintdef(oid) like '%split_part%'),
 'a_file_is_attached_once_per_company',exists(select 1 from pg_constraint where conrelid='public.work_attachments'::regclass and contype='u' and pg_get_constraintdef(oid) like '%company_id, path%'),
 'a_file_belongs_to_a_message_of_its_card',exists(select 1 from pg_constraint where conrelid='public.work_attachments'::regclass and contype='f' and confrelid='public.work_comments'::regclass and array_length(conkey,1)=3),
 'a_run_key_sees_its_card_files_only',exists(select 1 from pg_policies where schemaname='public' and tablename='work_attachments' and policyname='attachments_read' and qual like '%run_card%'),
 'attaching_runs_as_the_caller',not (select prosecdef from pg_proc where oid='public.attach_files(uuid,bigint,bigint,jsonb)'::regprocedure),
 'attaching_is_for_signed_in_people',has_function_privilege('authenticated','public.attach_files(uuid,bigint,bigint,jsonb)','execute') and not has_function_privilege('anon','public.attach_files(uuid,bigint,bigint,jsonb)','execute')
);
