-- #846: an Agent waits on the reader for no approval or note mention of the old board, and is stuck for no failure on
-- one of its Cards.
select json_build_object(
 'old_kinds_left_out',position($k$w.kind not in ('approval','mention')$k$ in pg_get_functiondef('public.agent_face_states(uuid)'::regprocedure))>0,
 'old_card_failures_left_out',position($k$when a.failed_card is null then a.failed_at end$k$ in pg_get_functiondef('public.agent_face_states(uuid)'::regprocedure))>0
);
