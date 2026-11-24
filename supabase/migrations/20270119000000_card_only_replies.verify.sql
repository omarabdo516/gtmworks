-- The close gained a form that says whether the closer read the Run completed (#227); the form the previous app version
-- calls stays. Both return boolean and only the service role runs them. What each closes as is proven in
-- supabase/tests/reply_cards.sql.
select json_build_object(
 'two_closes',(select count(*) from pg_proc where proname='close_conversation_run' and pronamespace='public'::regnamespace)=3 -- #708 adds the overload that takes a reply's files
  and pg_get_function_result('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint)'::regprocedure)='boolean'
  and pg_get_function_result('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)'::regprocedure)='boolean',
 'service_only',(select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute'))
  from unnest(array['public.close_conversation_run(uuid,text,text,text,text,bigint,bigint)','public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)']) f)
);
