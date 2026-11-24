-- A removed Agent keeps its face (#702, ADR 0027): its name is kept beside its look as it is removed, each record keeps
-- its Agent's id, a finished Handover outlives its Agents, and only the triggers write what is kept.
select json_build_object(
 'name_kept_on_removal',exists(select 1 from pg_trigger where tgrelid='public.hermes_agents'::regclass and tgname='agent_removed_keeps_face' and tgenabled<>'D'),
 'records_keep_their_agent',(select count(*)=3 from pg_trigger where tgname in ('conversations_keep_agent','channel_runs_keep_agent','work_cards_keep_agent') and tgenabled<>'D'),
 'handovers_outlive_their_agents',not exists(select 1 from pg_constraint where conrelid='public.agent_handovers'::regclass and contype='f' and confrelid='public.hermes_agents'::regclass),
 'kept_inside_only',not has_function_privilege('authenticated','public.keep_record_agent()','execute')
  and not has_function_privilege('authenticated','public.keep_removed_agent()','execute'),
 'channel_call_kept_readable',has_column_privilege('authenticated','public.channel_runs','kept_agent_id','select'),
 'no_living_agent_named',not exists(select 1 from public.agent_looks l join public.hermes_agents a on a.id=l.agent_id where l.kept_name is not null)
);
