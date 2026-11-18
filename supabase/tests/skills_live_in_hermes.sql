begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
-- #343, decision 0042: skills live only in Hermes. Every table and function of the database skills system is gone;
-- the path that writes approved lessons to the shared skill team-lessons stays (supabase/tests/shared_skills.sql), and
-- company separation on every kept table is supabase/tests/company_isolation.sql's.
select hasnt_table('public',t,format('%s is gone',t)) from unnest(array['skills','skill_versions','skill_enablements','skill_events','skill_loads','skill_lessons']) t;
select hasnt_function('public',f,format('%s is gone',f)) from unnest(array['skill_parse','install_skill','set_skill_enabled','agent_load_skills','skill_agents','propose_skill_lesson','decide_skill_lesson']) f;
select has_function('public','shared_skills_work',array[]::name[],'the worker still lists the lessons for team-lessons');
select ok(not has_function_privilege('authenticated','public.shared_skills_work()','execute'),'and only the worker may');
select * from finish();
rollback;
