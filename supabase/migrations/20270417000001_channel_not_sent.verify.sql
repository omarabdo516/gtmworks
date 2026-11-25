-- #765: a Channel turn that never started reads as such, and only a person may try it again.
select json_build_object(
 'started_readable',has_column_privilege('authenticated','public.channel_runs','started','select'),
 'retry_for_people',has_function_privilege('authenticated','public.retry_channel_run(uuid,bigint,smallint)','execute')
  and not has_function_privilege('anon','public.retry_channel_run(uuid,bigint,smallint)','execute')
);
