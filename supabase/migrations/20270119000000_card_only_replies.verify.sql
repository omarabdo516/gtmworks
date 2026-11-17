-- The close was only replaced (#227): one function by that name, same signature, service role only, and it counts the
-- three kinds of card a completed read stores, never a question card.
select json_build_object(
 'one_close',(select count(*) from pg_proc where proname='close_conversation_run' and pronamespace='public'::regnamespace)=1
  and pg_get_function_result('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint)'::regprocedure)='boolean',
 'service_only',has_function_privilege('service_role','public.close_conversation_run(uuid,text,text,text,text,bigint,bigint)','execute')
  and not has_function_privilege('authenticated','public.close_conversation_run(uuid,text,text,text,text,bigint,bigint)','execute')
  and not has_function_privilege('anon','public.close_conversation_run(uuid,text,text,text,text,bigint,bigint)','execute'),
 'counts_cards',(select bool_and(position(t in pg_get_functiondef('public.close_conversation_run(uuid,text,text,text,text,bigint,bigint)'::regprocedure))>0)
  from unnest(array['public.reply_cards','kind<>''question''','public.lead_made_agents','public.lead_agent_requests']) t)
);
