-- A Run's steps are no longer kept: the table and every function of it are gone.
select json_build_object(
 'table_gone',to_regclass('public.conversation_run_steps') is null,
 'functions_gone',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('run_steps_valid','run_steps_progress','keep_run_steps','note_run_steps','seal_run_steps'))
);
