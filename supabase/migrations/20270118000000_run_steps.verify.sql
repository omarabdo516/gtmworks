-- A Run's steps are one row per Run of a Conversation, read by its own person only and written by the service role
-- through the three functions alone; a step holds the call, the tool, the preview and its state, and nothing else.
select json_build_object(
 'steps_valid',public.run_steps_valid('[{"call":"call_1","tool":"web_search","preview":"accounting courses Cairo","state":"done"},{"call":"#4","tool":"terminal","preview":null,"state":"started"},{"call":"call_2","tool":"read_file","preview":null,"state":"failed"}]')
  and public.run_steps_valid('[]')
  and not public.run_steps_valid('{}')
  and not public.run_steps_valid('[{"call":"call_1","tool":"web_search","preview":null,"state":"skipped"}]')
  and not public.run_steps_valid('[{"call":"call_1","tool":"web_search","preview":"","state":"done"}]')
  and not public.run_steps_valid('[{"call":"call_1","tool":"web_search","state":"done"}]')
  and not public.run_steps_valid('[{"call":"call_1","tool":"web_search","preview":null,"state":"done","label":"Searched"}]')
  and not public.run_steps_valid('["web_search"]'),
 'table',(select relrowsecurity from pg_class where oid='public.conversation_run_steps'::regclass)
  and exists(select 1 from pg_policies where schemaname='public' and tablename='conversation_run_steps' and policyname='conversation_run_steps_read' and cmd='SELECT'),
 'readers_only_read',has_table_privilege('authenticated','public.conversation_run_steps','select')
  and not has_table_privilege('authenticated','public.conversation_run_steps','insert,update,delete')
  and not has_table_privilege('anon','public.conversation_run_steps','select,insert,update,delete')
  and not has_table_privilege('service_role','public.conversation_run_steps','select,insert,update,delete'),
 'service_writes',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.run_steps_progress(uuid,text)','public.note_run_steps(uuid,text,jsonb,integer,boolean,boolean,integer,double precision)','public.seal_run_steps(uuid,text,jsonb,integer,boolean,integer)']) f),
 'helpers_private',(select bool_and(not has_function_privilege(r,f,'execute'))
  from unnest(array['public.run_steps_valid(jsonb)','public.keep_run_steps(uuid,text,jsonb,integer,boolean,boolean,double precision,integer,boolean)']) f cross join unnest(array['anon','authenticated','service_role']) r)
);
