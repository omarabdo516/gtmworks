-- #602: since #530 a handover's leg keeps why its model call could not succeed (no_model, no_credit, key_refused,
-- model_missing, and #622's no_access), and the channel and the chat say it; the Agent that asked was still told only
-- that the job failed. begin_handover now names the cause in the words the channel and the chat use, with what the
-- Owner can do about it, in the asking Agent's follow-up and in an asked Agent's answer Run for each job it handed on
-- (the chain step, #477), and asks the follow-up to say why the job did not finish. A leg that failed for another
-- reason, was stopped or was lost reads as before.
--
-- Additive only, for the previous app version: begin_handover keeps its signature and its result; only the text of the
-- input it returns changes.

-- How an asked Agent's leg that did not complete ended, as the clause after "did not finish: it", ending its sentence:
-- `before` is what it did not get to (reporting anything, answering).
create function public.handover_not_finished(outcome text, before text) returns text
language sql immutable set search_path='' as $$
 select case coalesce(outcome,'failed')
  when 'stopped' then 'was stopped before ' || before || '.'
  when 'lost' then 'could not be found before ' || before || '.'
  when 'no_model' then 'could not reply: the company has no AI subscription or model key connected yet. The Owner can connect one in Providers.'
  when 'no_credit' then 'could not reply: the company''s model key has no credit left. The Owner can check the agent''s model in Providers.'
  when 'key_refused' then 'could not reply: the model provider refused the company''s key or sign-in. The Owner can check the agent''s model in Providers.'
  when 'model_missing' then 'could not reply: its model is not available from the provider. The Owner can check the agent''s model in Providers.'
  when 'no_access' then 'could not reply: every account it can use has run out of usage for now. The Owner can add an account or choose a fallback model in Providers.'
  else 'failed before ' || before || '.' end;
$$;
revoke all on function public.handover_not_finished(text,text) from public,anon,authenticated,service_role;

-- 20270415990000's begin_handover, with each ending read through handover_not_finished.
do $$
declare def text; was text;
begin
 def:=pg_get_functiondef('public.begin_handover(bigint)'::regprocedure);
 was:=E'case coalesce(c.target_outcome,''failed'') when ''stopped'' then ''was stopped'' when ''lost'' then ''could not be found'' else ''failed'' end\n      || '' before answering.''';
 if position(was in def)=0 then raise exception 'begin_handover changed: %',def; end if;
 def:=replace(def,was,'public.handover_not_finished(c.target_outcome,''answering'')');
 was:=E'case coalesce(r.target_outcome,''failed'') when ''stopped'' then ''was stopped'' when ''lost'' then ''could not be found'' else ''failed'' end\n   || '' before reporting anything.''';
 if position(was in def)=0 then raise exception 'begin_handover changed: %',def; end if;
 def:=replace(def,was,'public.handover_not_finished(r.target_outcome,''reporting anything'')');
 was:='say the job did not finish, and what you suggest.';
 if position(was in def)=0 then raise exception 'begin_handover changed: %',def; end if;
 execute replace(def,was,'say the job did not finish and why, and what you suggest.');
end $$;
