-- #452: agent_write makes an idea, with its Agent, under the request key.
select json_build_object(
 'idea_branch',position('elsif payload ? ''agent''' in pg_get_functiondef('public.agent_write(uuid,text,text,text,bigint,jsonb)'::regprocedure))>0,
 'run_key_guard_kept',position('run_card' in pg_get_functiondef('public.agent_write(uuid,text,text,text,bigint,jsonb)'::regprocedure))>0
);
