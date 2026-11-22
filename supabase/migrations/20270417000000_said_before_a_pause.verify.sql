-- #647: a question's or a request's card keeps what its Agent wrote before it, once per Run, in a Conversation and a Channel.
select json_build_object(
 'columns',exists(select 1 from information_schema.columns where table_schema='public' and table_name='reply_cards' and column_name='said')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='channel_permissions' and column_name='said'),
 'kept_by_every_pause',position('said_before' in pg_get_functiondef('public.track_run_question(uuid,text,jsonb,boolean,timestamptz)'::regprocedure))>0
  and position('said_before' in pg_get_functiondef('public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure))>0
  and position('said_before' in pg_get_functiondef('public.track_channel_question(bigint,text,jsonb,boolean,timestamptz)'::regprocedure))>0
  and position('said_before' in pg_get_functiondef('public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure))>0
);
