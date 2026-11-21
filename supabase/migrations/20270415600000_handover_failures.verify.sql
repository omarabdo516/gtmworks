-- #375: a person reads whether a handover's target finished, in a Conversation and in a channel, and an answer to a
-- channel start without a place never lands on a Run whose earlier Run could have made that attempt.
select json_build_object(
 'conversation_reads_the_target_outcome',has_column_privilege('authenticated','public.agent_handovers','target_outcome','select')
  and not has_column_privilege('authenticated','public.agent_handovers','summary','select'),
 'channel_reads_the_target_outcome',position('target_outcome' in pg_get_function_result('public.channel_handovers(uuid)'::regprocedure))>0
  and has_function_privilege('authenticated','public.channel_handovers(uuid)','execute')
  and not has_function_privilege('anon','public.channel_handovers(uuid)','execute')
  and not has_function_privilege('service_role','public.channel_handovers(uuid)','execute'),
 'place_free_answer_is_safe',position('o.attempts>=attempt' in pg_get_functiondef('public.answer_channel_start(bigint,integer,text,smallint)'::regprocedure))>0
  and has_function_privilege('service_role','public.answer_channel_start(bigint,integer,text,smallint)','execute')
  and not has_function_privilege('authenticated','public.answer_channel_start(bigint,integer,text,smallint)','execute')
);
