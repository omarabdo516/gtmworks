-- The column guard was the stage table's; since the Card cutover (#684) every move is checked by check_card_move, with an
-- empty search path, and not callable without signing in. Waiting on you is reached only by a review.
select json_build_object(
 'stage_guard_gone',to_regprocedure('public.work_stage_place()') is null,
 'moves_checked',(select proconfig @> array['search_path=""'] from pg_proc where oid=to_regprocedure('public.check_card_move(uuid,bigint,text)')),
 'not_callable_anonymously',not has_function_privilege('anon','public.check_card_move(uuid,bigint,text)','execute'),
 'waiting_only_by_review',position('waiting' in pg_get_functiondef(to_regprocedure('public.check_card_move(uuid,bigint,text)')))>0
);
