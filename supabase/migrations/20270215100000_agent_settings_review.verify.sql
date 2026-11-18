-- #352's review: an Agent settings row names About or Voice and keeps no text; an Agent mid-move is not choosable; an
-- Agent's own learning mode is a choice of auto/ask or none, readable by members and written by the Owner alone.
select json_build_object(
 'fields_limited',position('''about''' in pg_get_functiondef('public.log_agent_setting(uuid,uuid,text,text,text)'::regprocedure))>0
  and position('''voice''' in pg_get_functiondef('public.log_agent_setting(uuid,uuid,text,text,text)'::regprocedure))>0,
 'values_refused',position('old_value is not null or new_value is not null' in pg_get_functiondef('public.log_agent_setting(uuid,uuid,text,text,text)'::regprocedure))>0,
 'log_for_members',has_function_privilege('authenticated','public.log_agent_setting(uuid,uuid,text,text,text)','execute'),
 'log_private',not has_function_privilege('anon','public.log_agent_setting(uuid,uuid,text,text,text)','execute'),
 'choosable_needs_its_profile',position('g.profile=a.profile' in pg_get_functiondef('public.company_agent_models(uuid)'::regprocedure))>0,
 'rows_for_members',has_function_privilege('authenticated','public.company_agent_models(uuid)','execute'),
 'choice_additive',exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_profiles' and column_name='learning_mode_choice'),
 'choice_shaped',exists(select 1 from pg_constraint where conrelid='public.agent_profiles'::regclass and conname='agent_profiles_learning_mode_choice_shape'),
 'modes_for_members',has_function_privilege('authenticated','public.company_learning_modes(uuid)','execute'),
 'mode_owner_checked',position('is_company_owner' in pg_get_functiondef('public.set_agent_learning_mode(uuid,text)'::regprocedure))>0
);
