-- #646: the live steps' two lookups are the reader's own, run as their definer with an empty search path, and answer the
-- Run and its profile only.
select json_build_object(
 'reader_only',(select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('service_role',f,'execute')) from unnest(array['public.conversation_live_run(uuid)','public.channel_live_run(uuid)']) f),
 'as_definer',(select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in ('public.conversation_live_run(uuid)'::regprocedure,'public.channel_live_run(uuid)'::regprocedure)),
 'own_chat_only',position('cv.person_id=auth.uid()' in pg_get_functiondef('public.conversation_live_run(uuid)'::regprocedure))>0,
 'callable_agent_only',position('channel_agent(ch,auth.uid()' in pg_get_functiondef('public.channel_live_run(uuid)'::regprocedure))>0
);
