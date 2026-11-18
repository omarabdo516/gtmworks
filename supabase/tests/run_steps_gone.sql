begin;
create extension if not exists pgtap with schema extensions;
-- #346: a Run's steps are read from the Hermes session, so gtmworks keeps none: the table, its policy and its functions
-- are gone, and the record of each conversation they sat beside keeps its company separation (company_isolation.sql
-- covers every kept table).
select plan(8);
select hasnt_table('public','conversation_run_steps','the run steps table is gone, its policy and grants with it');
select is(to_regprocedure('public.run_steps_valid(jsonb)'),null,'run_steps_valid is gone');
select is(to_regprocedure('public.run_steps_progress(uuid,text)'),null,'run_steps_progress is gone');
select is(to_regprocedure('public.keep_run_steps(uuid,text,jsonb,integer,boolean,boolean,double precision,integer,boolean)'),null,'keep_run_steps is gone');
select is(to_regprocedure('public.note_run_steps(uuid,text,jsonb,integer,boolean,boolean,integer,double precision)'),null,'note_run_steps is gone');
select is(to_regprocedure('public.seal_run_steps(uuid,text,jsonb,integer,boolean,integer)'),null,'seal_run_steps is gone');
select is((select count(*)::int from pg_policies where policyname='conversation_run_steps_read'),0,'its read policy is gone');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%run_steps%'),0,'no function of the run steps is left');
select * from finish();
rollback;
