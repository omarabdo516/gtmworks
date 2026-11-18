-- #343: no skill table or skill function is left in the database.
select json_build_object(
 'skill_tables_gone',(select bool_and(to_regclass('public.'||t) is null) from unnest(array['skills','skill_versions','skill_enablements','skill_events','skill_loads','skill_lessons']) t),
 'skill_functions_gone',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('skill_parse','install_skill','set_skill_enabled','agent_load_skills','skill_agents','propose_skill_lesson','decide_skill_lesson'))
);
