-- #602: a handover's follow-up and an asked Agent's answer Run name why an asked Agent's model call failed, and the
-- wording function is the database's own.
select json_build_object(
 'begin_handover_names_the_cause',position('handover_not_finished(c.target_outcome' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))>0
  and position('handover_not_finished(r.target_outcome' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))>0
  and position('did not finish and why' in pg_get_functiondef('public.begin_handover(bigint)'::regprocedure))>0,
 'every_cause_is_worded',public.handover_not_finished('no_credit','x') like 'could not reply:%'
  and public.handover_not_finished('no_access','x') like 'could not reply:%'
  and public.handover_not_finished('failed','reporting anything')='failed before reporting anything.',
 'nobody_calls_the_wording',not has_function_privilege('authenticated','public.handover_not_finished(text,text)','execute')
  and not has_function_privilege('anon','public.handover_not_finished(text,text)','execute')
);
