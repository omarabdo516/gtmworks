-- #344 (spec #340, decision 0042): the Company knowledge is the shared Skill "company-knowledge" in the Company's shared
-- space in the bundled Engine, beside "team-lessons" (lib/company-knowledge-skill.mjs). Every Agent profile of the
-- Company auto-loads it and holds it locked, so no Run is told it any more. gtmworks keeps only who may edit it and the
-- log of each edit: check_company_knowledge checks a save before the Engine is written, and log_company_knowledge
-- records it once written, in company_audit as before.
--
-- Dropped, with no copy into the Engine (Omar: nobody uses the table): company_knowledge, the run pins of its text
-- (pin_run_knowledge, channel_run_knowledge, note_run_knowledge and their columns and triggers), company_knowledge_now
-- and save_company_knowledge. Every profile's shared folder is confirmed again, so the worker has each one auto-load
-- and lock the new Skill too; until it has, a Run on that profile waits, as for a new profile (20270102000000).
-- The previous app version cannot save or read the knowledge against this, and its Runs would fail to pin it; the spec
-- accepts that a rollback to it finds these missing.

drop trigger if exists channel_runs_knowledge on public.channel_runs;
drop trigger if exists note_runs_knowledge on public.note_runs;
drop function if exists public.pin_channel_run_knowledge();
drop function if exists public.pin_run_knowledge(uuid,uuid);
drop function if exists public.channel_run_knowledge(bigint);
drop function if exists public.note_run_knowledge(bigint);
drop function if exists public.company_knowledge_now(uuid);
drop function if exists public.save_company_knowledge(uuid,text,text);
alter table if exists public.conversation_run_notes drop column if exists knowledge;
alter table if exists public.channel_runs drop column if exists knowledge;
alter table if exists public.note_runs drop column if exists knowledge;
drop table if exists public.company_knowledge;

-- An active Owner or Manager may save a part: the text trimmed, or a refusal whose key the screen shows. An empty text
-- clears the part. company_knowledge_parts stays the list of parts (lib/company-knowledge.mjs).
create function public.check_company_knowledge(c uuid, part text, body text) returns text
language plpgsql stable security definer set search_path='' as $$
declare kept text:=btrim(coalesce(check_company_knowledge.body,''),E' \t\r\n');
begin
 if not public.can_manage_company(c) then raise exception 'companyKnowledgeNotAllowed' using errcode='42501'; end if;
 if check_company_knowledge.part is null or array_position(public.company_knowledge_parts(),check_company_knowledge.part) is null then raise exception 'companyKnowledgeInvalid' using errcode='22023'; end if;
 if length(kept)>20000 then raise exception 'companyKnowledgeTooLong' using errcode='22023'; end if;
 if public.secret_like(kept) then raise exception 'companyKnowledgeSecret' using errcode='22023'; end if;
 return kept;
end $$;
revoke all on function public.check_company_knowledge(uuid,text,text) from public,anon,service_role;
grant execute on function public.check_company_knowledge(uuid,text,text) to authenticated;

-- A saved edit, logged as the signed-in Owner or Manager; the Company's log copies it (log_company_change).
create function public.log_company_knowledge(c uuid, part text, cleared boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.can_manage_company(c) then raise exception 'companyKnowledgeNotAllowed' using errcode='42501'; end if;
 if log_company_knowledge.part is null or array_position(public.company_knowledge_parts(),log_company_knowledge.part) is null or cleared is null then raise exception 'companyKnowledgeInvalid' using errcode='22023'; end if;
 insert into public.company_audit(company_id,actor_id,action,knowledge_part,knowledge_cleared) values (c,auth.uid(),'company_knowledge_changed',log_company_knowledge.part,cleared);
end $$;
revoke all on function public.log_company_knowledge(uuid,text,boolean) from public,anon,service_role;
grant execute on function public.log_company_knowledge(uuid,text,boolean) to authenticated;

update public.company_profiles set skills_shared=false where skills_shared;
update public.agent_profiles set skills_shared=false where skills_shared;
