-- The board's read and a Card's crew are the reader's, run as the reader, and the board's read asks can_see_agent.
select json_build_object(
 'for_people',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
  from unnest(array['public.board_cards(uuid)','public.crew(public.work_cards)']) f),
 'as_the_reader',(select bool_and(not prosecdef and proconfig=array['search_path=""']) from pg_proc where oid in ('public.board_cards(uuid)'::regprocedure,'public.crew(public.work_cards)'::regprocedure)),
 'hides_agents',position('can_see_agent' in pg_get_functiondef('public.board_cards(uuid)'::regprocedure))>0,
 'shapes',pg_get_function_result('public.board_cards(uuid)'::regprocedure) in ('SETOF work_cards','SETOF public.work_cards')
  and pg_get_function_result('public.crew(public.work_cards)'::regprocedure)='uuid[]'
);
