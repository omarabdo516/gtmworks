-- A claimed choice is handed to one closer at a time, under the 15 seconds each closer's function gives it, in a
-- Conversation and in a channel.
select json_build_object(
 'column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='channel_permissions' and column_name='delivering_at'),
 'handed_once',position('delivering_at<now()-interval ''15 seconds''' in pg_get_functiondef('public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure))>0
  and position('delivering_at<now()-interval ''15 seconds''' in pg_get_functiondef('public.track_channel_permission(bigint,text,jsonb,boolean,timestamptz,timestamptz,text)'::regprocedure))>0
);
