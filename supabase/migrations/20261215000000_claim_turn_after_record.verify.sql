-- A claim takes the agents lock, under which a start is recorded, before it reads the open run or the next turn.
select json_build_object(
 'claim_reads_after_record',position('hermes_agents' in pg_get_functiondef('public.claim_conversation_turn(uuid)'::regprocedure))
  between 1 and position('conversation_open_run' in pg_get_functiondef('public.claim_conversation_turn(uuid)'::regprocedure))
  and position('conversation_turn:' in pg_get_functiondef('public.claim_conversation_turn(uuid)'::regprocedure))
  < position('hermes_agents' in pg_get_functiondef('public.claim_conversation_turn(uuid)'::regprocedure))
);
