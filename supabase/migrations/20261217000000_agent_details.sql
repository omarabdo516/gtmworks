-- An Agent's details (#20; reference: renderDetailsPanel, tasksHTML): the Cards it works on and what it is doing now.
-- Nothing existing is rewritten: a Card belongs to no Agent until one is set, and the previous app version reads and
-- writes Cards as before.

alter table public.hermes_agents add constraint hermes_agents_company_id_id_key unique (company_id,id);
-- A Card's Agent is one of its own Company's Agents; removing the Agent leaves the Card on the board with no Agent.
alter table public.work_cards add column agent_id uuid,
 add constraint work_cards_agent_fkey foreign key (company_id,agent_id) references public.hermes_agents(company_id,id) on delete set null (agent_id);
create index work_cards_agent on public.work_cards(company_id,agent_id) where agent_id is not null;
create index conversations_agent on public.conversations(company_id,agent_id);

-- What an Agent is doing now: the newest run still open in any of the Company's Conversations with it (open as
-- conversation_open_run decides). Everyone who sees the Agent learns when it started; only the person whose
-- Conversation it is learns which one, so another person's request stays theirs.
create function public.agent_open_run(c uuid, agent uuid) returns table(started_at timestamptz, conversation uuid)
language sql stable security definer set search_path='' as $$
 select m.created_at,case when cv.person_id=auth.uid() then cv.id end
 from public.conversations cv
 cross join lateral public.conversation_open_run(cv.id) o
 join public.conversation_messages m on m.id=o.message
 where cv.company_id=c and cv.agent_id=agent and public.can_see_agent(c,agent)
 order by m.created_at desc,m.id desc limit 1;
$$;
revoke all on function public.agent_open_run(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.agent_open_run(uuid,uuid) to authenticated;
