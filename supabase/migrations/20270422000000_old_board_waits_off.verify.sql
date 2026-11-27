-- #846: an Agent waits on the reader for no approval or note mention of the old board.
select json_build_object(
 'old_kinds_left_out',position($k$w.kind not in ('approval','mention')$k$ in pg_get_functiondef('public.agent_face_states(uuid)'::regprocedure))>0
);
