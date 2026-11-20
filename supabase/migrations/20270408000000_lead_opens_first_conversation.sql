-- #434: Lead, the main Agent, manages its Company's team, and opens a new Company's first Conversation.
--
-- Lead's identity is its Company profile's SOUL.md (lib/company-profiles.mjs). A profile made before #434 holds the old
-- default text: the worker reads each Company profile once and writes the manager's text only where the old one is
-- still there, so an Owner's own instructions stay. A profile stays listed until a read the Engine answered is recorded.
alter table public.company_profiles add column lead_soul_checked boolean not null default false;

create function public.lead_soul_work() returns table(company_id uuid, profile text) language sql stable security definer set search_path='' as $$
 select p.company_id,p.profile from public.company_profiles p where not p.lead_soul_checked order by p.company_id;
$$;
revoke all on function public.lead_soul_work() from public,anon,authenticated,service_role;
grant execute on function public.lead_soul_work() to service_role;

create function public.record_lead_soul(c uuid, engine_profile text) returns boolean language sql security definer set search_path='' as $$
 update public.company_profiles p set lead_soul_checked=true where p.company_id=c and p.profile=engine_profile returning true;
$$;
revoke all on function public.record_lead_soul(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.record_lead_soul(uuid,text) to service_role;

-- What counts as written in a Company: any message but Lead's opening and a person's message whose Run ended for want of
-- a model (#422), so an Owner who typed before connecting one still gets the opening once it is connected.
create function public.written_message(m public.conversation_messages) returns boolean language sql stable set search_path='' as $$
 select m.run_id<>'lead-opening' and not (m.author='person' and exists(select 1 from public.conversation_run_ends e
  where e.conversation_id=m.conversation_id and e.run_id=m.run_id and e.outcome='no_model'));
$$;
revoke all on function public.written_message(public.conversation_messages) from public,anon,authenticated,service_role;

-- The first Conversation: once per Company, ever. When an active Owner opens the main Agent's chat, or an empty
-- Conversation with it, while the Company has a model and nothing was written in any of its Conversations yet, the app
-- asks for Lead's message, in the Owner's language, to be the first one (lib/lead-opening.mjs). It goes into the
-- Conversation first run made for the Owner (choose_work_mode) or any other of theirs with the main Agent: the one named
-- when it is such a one, else the oldest; an Owner with none gets a new one under the given id. Its run id is
-- 'lead-opening': no Engine run made it. Once it is written the Company has a message, so it is never written twice, and
-- a Company where someone wrote first is never opened; the Company row is locked first, so two tabs at once write one.
-- The service role alone writes it, so nobody can put words in Lead's mouth. Answers the Conversation opened, or the
-- Owner's opening while nobody has written in the Company since, or null.
create function public.open_first_conversation(c uuid, person uuid, conversation uuid, body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare lead public.hermes_agents; target uuid;
begin
 perform 1 from public.companies where id=c for update;
 if not found then return null; end if;
 -- Opened already: until anyone writes in the Company, the Owner's visit goes back to it, whichever visit wrote it
 -- (a link's prefetch renders the page too, and its move to the Conversation goes nowhere).
 select m.conversation_id into target from public.conversation_messages m join public.conversations v on v.id=m.conversation_id
  where m.company_id=c and m.run_id='lead-opening' and v.person_id=person;
 if found then
  return case when not exists(select 1 from public.conversation_messages m where m.company_id=c and public.written_message(m))
   and not exists(select 1 from public.conversation_run_reservations r where r.company_id=c) then target end;
 end if;
 -- Opened for another Owner, or written in: never a second opening.
 if exists(select 1 from public.conversation_messages m where m.company_id=c and (m.run_id='lead-opening' or public.written_message(m)))
  or exists(select 1 from public.conversation_run_reservations r where r.company_id=c) then return null; end if;
 if not exists(select 1 from public.members m where m.company_id=c and m.person_id=person and m.role='owner' and m.removed_at is null) then return null; end if;
 select * into lead from public.hermes_agents a where a.company_id=c and a.is_default;
 if not found then return null; end if;
 select v.id into target from public.conversations v where v.company_id=c and v.person_id=person and v.agent_id=lead.id
  order by v.id=conversation desc,v.created_at,v.id limit 1;
 if target is null then
  target:=conversation;
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values(target,c,person,lead.id,lead.name);
 end if;
 insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id)
  values(c,target,'agent',lead.id,lead.name,body,'lead-opening');
 return target;
end $$;
revoke all on function public.open_first_conversation(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.open_first_conversation(uuid,uuid,uuid,text) to service_role;

-- 20270323000000's brief, which now also carries Lead's opening message when the Run answers it: the Run's Conversation
-- is the one Lead opened and its person has written nothing there yet (the Run's own message is stored once it starts),
-- so that answer, and no later message, is met with the first Agents to make (lib/lead-offer.mjs).
create or replace function public.pin_lead_brief(conversation uuid, message_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare held public.conversation_run_reservations; kept public.conversation_run_notes;
begin
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key for update;
 select * into kept from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if kept.conversation_id is null then return null; end if;
 if kept.lead_brief is null and held.conversation_id is not null and held.start_attempts=0 and held.start_unknown_at is null
  and exists(select 1 from public.hermes_agents a where a.id=held.agent_id and a.company_id=held.company_id and a.is_default) then
  update public.conversation_run_notes n set lead_brief=jsonb_build_object(
   'role',(select m.role from public.members m where m.company_id=held.company_id and m.person_id=held.person_id and m.removed_at is null),
   'owner',(select split_part(p.name,' ',1) from public.members m join public.people p on p.id=m.person_id
     where m.company_id=held.company_id and m.role='owner' and m.removed_at is null order by p.name limit 1),
   'agents',coalesce((select jsonb_agg(jsonb_build_object('name',a.name,'job',a.speciality) order by a.name,a.id)
     from public.hermes_agents a
     where a.company_id=held.company_id and a.id<>held.agent_id and public.agent_visible_to(held.company_id,held.person_id,a.id)),'[]'::jsonb),
   'opening',(select m.body from public.conversation_messages m where m.conversation_id=conversation and m.author='agent' and m.run_id='lead-opening'
     and not exists(select 1 from public.conversation_messages p where p.conversation_id=conversation and p.author='person' and public.written_message(p))))
   where n.conversation_id=conversation and n.send_key=message_key returning * into kept;
 end if;
 return kept.lead_brief;
end $$;
