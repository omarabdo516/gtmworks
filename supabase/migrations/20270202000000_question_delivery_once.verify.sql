-- A claimed answer is handed to one closer at a time, under the 15 seconds track_run_question gives it.
select json_build_object(
 'column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='reply_cards' and column_name='delivering_at'),
 'handed_once',position('delivering_at<now()-interval ''15 seconds''' in pg_get_functiondef('public.track_run_question(uuid,text,jsonb,boolean,timestamptz)'::regprocedure))>0
);
