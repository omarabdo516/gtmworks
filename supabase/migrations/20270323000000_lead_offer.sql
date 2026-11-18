-- #143: the main Agent, Lead, knows what the person writing to it sees, and offers to make an Agent (or to ask the Owner
-- for one) for work no Agent of theirs does. The words are Lead's own, so gtmworks gives it the facts with each Run and
-- the exact words and choices to use in the person's language; lib/lead-offer.mjs writes them from the brief pinned
-- here, and the Run sends that text as its instructions.
--
-- The brief is pinned once, at a Run's first start, like its tools (pin_run): it names the person's role in the Company,
-- the Owner's first name and the Agents that person sees. A retry sends the same text whatever changed meanwhile. Only
-- the main Agent's Runs have a brief; any other Agent's stays null. Lead's profile SOUL is not touched, since the brief
-- belongs to one person and one Run.
--
-- Nothing existing is rewritten: a column added and a function added, for the service role alone.

alter table public.conversation_run_notes add column lead_brief jsonb;

-- The brief of one Run: its person's role, the Owner's first name, and the other Agents that person sees, by the name
-- and job the team knows. Pinned before the first start and answered as pinned on every later attempt; a Run of any
-- Agent but the main one answers null and pins nothing. A note row that is not there answers null.
create function public.pin_lead_brief(conversation uuid, message_key uuid) returns jsonb
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
     where a.company_id=held.company_id and a.id<>held.agent_id and public.agent_visible_to(held.company_id,held.person_id,a.id)),'[]'::jsonb))
   where n.conversation_id=conversation and n.send_key=message_key returning * into kept;
 end if;
 return kept.lead_brief;
end $$;
revoke all on function public.pin_lead_brief(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.pin_lead_brief(uuid,uuid) to service_role;
