-- The column guard runs on every insert and update of a stage, as the function's owner, and no stage before review is
-- shown as Live or Done.
select json_build_object(
 'guard_on_insert_and_update',exists(select 1 from pg_trigger where tgrelid='public.work_stages'::regclass and tgname='work_stage_place' and tgenabled='O'
  and (tgtype & 4)<>0 and (tgtype & 16)<>0),
 'places_as_owner',(select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.work_stage_place()'::regprocedure),
 'not_callable_by_people',not has_function_privilege('authenticated','public.work_stage_place()','execute') and not has_function_privilege('anon','public.work_stage_place()','execute'),
 'no_early_stage_live_or_done',not exists(select 1 from public.work_stages where kind in ('ideas','before_review') and board_column in ('live','done'))
);
