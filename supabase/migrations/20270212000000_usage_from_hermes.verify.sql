-- Token use is no longer kept: conversation_usage and its reader are gone, no Run keeps tokens and no function names
-- the old table; how each Run ended stays, with row-level security.
select json_build_object(
 'table_gone',to_regclass('public.conversation_usage') is null,
 'reader_gone',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('usage_by_day','record_reply_usage')),
 'no_tokens',not exists(select 1 from information_schema.columns where table_schema='public' and table_name in ('conversation_run_ends','channel_runs','note_runs') and column_name in ('input_tokens','output_tokens')),
 'no_function_names_it',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc like '%conversation_usage%'),
 'ends_kept',(select relrowsecurity from pg_class where oid='public.conversation_run_ends'::regclass)
);
