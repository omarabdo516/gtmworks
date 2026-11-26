-- Spec #831 (#844): an Agent in a Conversation gives a job to another Agent of its Company, or keeps long work of its
-- own, as a Card on the Company's board with the Engine's own Kanban tool, kanban_create, whose assignee is the profile
-- the Engine knows the Agent by (its board name). Every Agent's Run is therefore told the board names of the Agents its
-- person sees and its own, pinned once with the Run as the main Agent's brief is, so a retry sends the same words; and a
-- job command sent to the main Agent (#358, #470) becomes a Card for the Agent of that role, read from the same brief by
-- the Agents' ready-made role (`role`). gtmworks offers no Card tool of its own and keeps nothing new about the Card.
--
-- pin_run_brief is 20270415100000's pin_lead_brief for every Agent's Run, not only the main one's, adding to the brief
-- `main` (whether the Run's Agent is the main one), `self` (the profile the Run was reserved on) and, for each Agent
-- listed, `board` (its profile, when it runs on one of its own, or is the main Agent on the Company's) and `role` (its
-- ready-made role). The main Agent's opening and the hidden jobs stay its own.
--
-- Nothing existing is rewritten: the previous app version keeps calling pin_lead_brief, which pins the main Agent's brief
-- only and reads the same column, so a brief either version pinned is the one a retry of that Run sends.
create function public.pin_run_brief(conversation uuid, message_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare held public.conversation_run_reservations; kept public.conversation_run_notes; main boolean;
begin
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key for update;
 select * into kept from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if kept.conversation_id is null then return null; end if;
 select a.is_default into main from public.hermes_agents a where a.id=held.agent_id and a.company_id=held.company_id;
 if kept.lead_brief is null and held.conversation_id is not null and held.start_attempts=0 and held.start_unknown_at is null and main is not null then
  update public.conversation_run_notes n set lead_brief=jsonb_build_object(
   'main',main,
   'self',held.profile,
   'role',(select m.role from public.members m where m.company_id=held.company_id and m.person_id=held.person_id and m.removed_at is null),
   'owner',(select split_part(p.name,' ',1) from public.members m join public.people p on p.id=m.person_id
     where m.company_id=held.company_id and m.role='owner' and m.removed_at is null order by p.name limit 1),
   'agents',coalesce((select jsonb_agg(jsonb_build_object('name',a.name,'job',a.speciality,'role',a.template,
      'board',case when a.profile is not null and (a.is_default or a.profile=public.agent_engine_profile(a.id)) then a.profile end) order by a.name,a.id)
     from public.hermes_agents a
     where a.company_id=held.company_id and a.id<>held.agent_id and public.agent_visible_to(held.company_id,held.person_id,a.id)),'[]'::jsonb),
   'opening',case when main then (select m.body from public.conversation_messages m where m.conversation_id=conversation and m.author='agent' and m.run_id='lead-opening'
     and not exists(select 1 from public.conversation_messages p where p.conversation_id=conversation and p.author='person' and public.written_message(p))) end,
   'hidden',case when main and public.may_ask_to_open_agents(held.company_id,held.agent_id,held.person_id) then coalesce((
     select jsonb_agg(jsonb_build_object('job',h.job,'asks',split_part(p.name,' ',1),'role',m.role) order by h.job)
      from (select distinct on (lower(btrim(a.speciality))) btrim(a.speciality) job, public.agent_access_named(held.company_id,held.person_id,a.id) named
        from public.agents_hidden_from(held.company_id,held.person_id) a where length(btrim(a.speciality))>0
        order by lower(btrim(a.speciality)),a.id) h
      join public.people p on p.id=h.named
      join public.members m on m.company_id=held.company_id and m.person_id=h.named),'[]'::jsonb) else '[]'::jsonb end)
   where n.conversation_id=conversation and n.send_key=message_key returning * into kept;
 end if;
 return kept.lead_brief;
end $$;
revoke all on function public.pin_run_brief(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pin_run_brief(uuid,uuid) to service_role;
