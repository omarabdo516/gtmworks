-- #476: any Agent of a channel hands over, to any other Agent of its Company in the channel or not; the tool's enum
-- comes from the worker's own list with job lines; a queued start re-checks its sender and the asking Agent, not the
-- target's place in the channel; the job names the Agent that asked.
select json_build_object(
 'any_agent_of_the_channel_hands_over',position('is_company_lead' in pg_get_functiondef('public.channel_can_hand_over(uuid,uuid,uuid)'::regprocedure))=0,
 'any_target_of_the_company',position('channel_agent' in pg_get_functiondef('public.channel_hand_to_agent(bigint,text,text,text,text,text)'::regprocedure))=0,
 -- #477 moved the rule into handover_writer, which begin_handover asks, with the chain's first asking Agent.
 'a_start_rechecks_its_sender',position('not public.handover_writer(h)' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))>0
  and position('channel_can_hand_over(chan,person,root.from_agent)' in pg_get_functiondef('public.handover_writer(bigint)'::regprocedure))>0
  and position('channel_agent(chan, person, target.id)' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))=0,
 'the_job_names_the_asking_agent',position('Lead in the team is handing you a job in this channel' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))=0,
 'targets_listed_for_the_worker',has_function_privilege('service_role','public.channel_handover_targets(bigint)','execute')
  and not has_function_privilege('authenticated','public.channel_handover_targets(bigint)','execute')
  and not has_function_privilege('anon','public.channel_handover_targets(bigint)','execute')
);
