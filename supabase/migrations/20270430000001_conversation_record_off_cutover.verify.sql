-- #883, the cutover: the Company switch of #876 is gone, and the old record's tables are all still there.
select json_build_object(
 'switch_gone',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='engine_conversations'),
 'old_record_kept',to_regclass('public.conversation_messages') is not null and to_regclass('public.conversation_run_resets') is not null
  and to_regclass('public.conversation_run_ran_out') is not null and to_regclass('public.conversation_notes') is not null
);
