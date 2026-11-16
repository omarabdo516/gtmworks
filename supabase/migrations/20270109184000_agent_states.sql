-- The state of every Agent the reader sees, in one call for the sidebar and Settings (#184): the rule the details
-- panel applies to one Agent (app/agent-details-server.tsx). Running is an open Run of the Agent; waiting_mine is an
-- item of the reader's own waiting list on one of the Agent's Cards. It runs as the reader, so their read rules apply.
create function public.agent_states(c uuid) returns table(agent uuid, running boolean, waiting_mine boolean)
language sql stable set search_path='' as $$
 with mine as (select distinct w.card_id from public.waiting_list(c) w where w.card_id is not null)
 select h.id,exists(select 1 from public.agent_open_run(c,h.id)),
  exists(select 1 from public.work_cards k join mine on mine.card_id=k.id where k.company_id=c and k.agent_id=h.id)
 from public.hermes_agents h where h.company_id=c and public.can_see_agent(c,h.id);
$$;
revoke all on function public.agent_states(uuid) from public,anon,authenticated,service_role;
grant execute on function public.agent_states(uuid) to authenticated;
