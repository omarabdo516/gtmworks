-- #9: a Company stores whether its Owner works alone or with a team. A Company that existed before the question keeps
-- working as it does today, as a team; one made by first run starts with no answer, and its Owner is asked once.
alter table public.companies add column work_mode text default 'team' check (work_mode in ('alone','team'));

-- The first person is the first Company's Owner; nobody else is created. The Company waits for the Owner's answer.
create or replace function public.complete_setup(person uuid, person_name text, company_name text, language text) returns text language plpgsql security definer set search_path='' as $$
declare company uuid:=gen_random_uuid(); slug text;
begin
 perform pg_advisory_xact_lock(238, 1);
 if not public.setup_is_open() then raise exception 'Setup closed'; end if;
 if length(trim(person_name)) not between 1 and 120 or length(trim(company_name)) not between 1 and 120 or language not in ('en','ar') or person_name is null or company_name is null or language is null then raise exception 'Invalid setup'; end if;
 slug:=coalesce(nullif(trim(both '-' from regexp_replace(lower(company_name),'[^a-z0-9]+','-','g')),''),'company') || '-' || left(company::text,8);
 insert into public.people(id,name,language) values(person,person_name,language);
 insert into public.companies(id,slug,name,work_mode) values(company,slug,company_name,null);
 insert into public.members(company_id,person_id,role,grant_publishing,grant_money_figures,grant_customer_data) values(company,person,'owner',true,true,true);
 update public.setup_claim set closed=true where singleton;
 return slug;
end $$;

-- The Owner's answer, given once. The workspace then opens on the Owner's one Conversation with the main Agent, Lead,
-- returned here; until the worker has given the Company its Lead there is none yet, and null is returned.
create function public.choose_work_mode(c uuid, mode text) returns uuid language plpgsql security definer set search_path='' as $$
declare main_agent public.hermes_agents; conversation uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.members m where m.company_id=c and m.person_id=auth.uid() and m.role='owner' and m.removed_at is null) then
  raise exception 'workModeOwnerOnly' using errcode='42501';
 end if;
 if mode is null or mode not in ('alone','team') then raise exception 'workModeInvalid' using errcode='22023'; end if;
 update public.companies set work_mode=mode where id=c and work_mode is null;
 if not found then raise exception 'workModeChosen' using errcode='P0001'; end if;
 select * into main_agent from public.hermes_agents a where a.company_id=c and a.is_default;
 if found and not exists(select 1 from public.conversations v where v.company_id=c and v.person_id=auth.uid()) then
  conversation:=gen_random_uuid();
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(conversation,c,auth.uid(),main_agent.id,main_agent.name);
 end if;
 return conversation;
end $$;
revoke all on function public.choose_work_mode(uuid,text) from public,anon,service_role;
grant execute on function public.choose_work_mode(uuid,text) to authenticated;
