-- #705: the board's archive list is read a page at a time and searched by title through archived_card_list, and counted
-- through archived_card_count, each the signed-in person's own, run as its definer with an empty search path.
select json_build_object(
 'member_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('service_role',f,'execute')) from unnest(array['public.archived_card_list(uuid,text,uuid,bigint,timestamptz,bigint,integer)','public.archived_card_count(uuid)']) f),
 'as_definer',(select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.archived_card_list(uuid,text,uuid,bigint,timestamptz,bigint,integer)'::regprocedure,'public.archived_card_count(uuid)'::regprocedure)),
 'searched_folded',position('search_fold(w.title)' in pg_get_functiondef('public.archived_card_list(uuid,text,uuid,bigint,timestamptz,bigint,integer)'::regprocedure))>0
);
