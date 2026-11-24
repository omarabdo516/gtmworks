-- Ready-made roles' looks (#697): a Member reads them through ready_made_looks only, its Company's alone, and the
-- automatic choice stays inside the database.
select json_build_object(
 'preview_signed_in_only',has_function_privilege('authenticated','public.ready_made_looks(uuid,text[])','execute')
  and not has_function_privilege('anon','public.ready_made_looks(uuid,text[])','execute'),
 'preview_members_only',(select prosecdef and proconfig @> array['search_path=""'] and position('is_member(c)' in pg_get_functiondef(oid))>0
  from pg_proc where oid='public.ready_made_looks(uuid,text[])'::regprocedure),
 'auto_inside_only',not has_function_privilege('authenticated','public.agent_look_auto(uuid,text)','execute')
  and not has_function_privilege('service_role','public.agent_look_auto(uuid,text)','execute'),
 'given_by_the_same_choice',position('agent_look_auto' in pg_get_functiondef('public.give_agent_look(uuid,uuid,boolean,text,bigint)'::regprocedure))>0
);
