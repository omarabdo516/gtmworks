-- A channel's several-pick question takes its picks (#651): answer_channel_question takes them, only a Member may call
-- it, and track_channel_question hands each answer over as it is kept.
select json_build_object(
 'picks_by_members_only',has_function_privilege('authenticated','public.answer_channel_question(uuid,uuid,bigint,integer,text,uuid,integer[])','execute')
  and not has_function_privilege('anon','public.answer_channel_question(uuid,uuid,bigint,integer,text,uuid,integer[])','execute')
  and not has_function_privilege('service_role','public.answer_channel_question(uuid,uuid,bigint,integer,text,uuid,integer[])','execute'),
 'one_answer_channel_question',(select count(*) from pg_proc where proname='answer_channel_question' and pronamespace='public'::regnamespace)=1,
 'answer_handed_as_kept',position('content->''answer''' in pg_get_functiondef('public.track_channel_question(bigint,text,jsonb,boolean,timestamptz)'::regprocedure))>0
  and has_function_privilege('service_role','public.track_channel_question(bigint,text,jsonb,boolean,timestamptz)','execute')
  and not has_function_privilege('authenticated','public.track_channel_question(bigint,text,jsonb,boolean,timestamptz)','execute')
);
