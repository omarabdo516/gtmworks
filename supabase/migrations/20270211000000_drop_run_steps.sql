-- #346 (decision 0042): a Run's steps are read from the Agent's Hermes session when the chat opens, so gtmworks keeps
-- no copy. The table of #141, its read policy and grants, and the functions that wrote and read it are dropped, with no
-- copy of what they held. Nothing else refers to them. The previous app version still reads the table and writes
-- through the functions: its reads then find no steps and its writes fail, logged, and leave each Run to close as before.
drop function if exists public.seal_run_steps(uuid,text,jsonb,integer,boolean,integer);
drop function if exists public.note_run_steps(uuid,text,jsonb,integer,boolean,boolean,integer,double precision);
drop function if exists public.keep_run_steps(uuid,text,jsonb,integer,boolean,boolean,double precision,integer,boolean);
drop function if exists public.run_steps_progress(uuid,text);
drop table if exists public.conversation_run_steps;
drop function if exists public.run_steps_valid(jsonb);
