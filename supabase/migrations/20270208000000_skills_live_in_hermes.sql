-- #343, decision 0042: skills live only in Hermes, in each Agent's own profile and the Company's shared folder
-- (lib/company-skills.mjs, lib/shared-skills.mjs). The database skills system goes: skills, their versions, enablements,
-- loads, events and lessons, the install check and the functions that wrote and read them. No data is copied. An
-- approved learning suggestion still reaches the shared skill team-lessons through agent_rules (shared_skills_work).
-- The previous app version reads these tables on its Skills page only, which then fails to load; nothing else it runs
-- touches them. Order-independent: every drop holds when an object is already gone.
drop function if exists public.decide_skill_lesson(uuid,bigint,boolean);
drop function if exists public.propose_skill_lesson(uuid,uuid,text,text,text,text,text);
drop function if exists public.agent_load_skills(uuid,uuid);
drop function if exists public.set_skill_enabled(uuid,uuid,uuid,boolean);
drop function if exists public.install_skill(uuid,text,text);
drop function if exists public.skill_agents(uuid);
drop function if exists public.skill_parse(text);
-- Each table's policies and grants go with it; the lessons and loads first, as they point at the skills and versions.
drop table if exists public.skill_lessons;
drop table if exists public.skill_loads;
drop table if exists public.skill_events;
drop table if exists public.skill_enablements;
drop table if exists public.skill_versions;
drop table if exists public.skills;
