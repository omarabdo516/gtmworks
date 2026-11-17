-- The board's read (#190): the Company's Cards the reader may see, less the Cards of an Agent hidden from them (#15).
-- It runs as the reader, so the Card read rules (#221) still apply; a Card with no Agent, or the main Agent's, stays.
create function public.board_cards(c uuid) returns setof public.work_cards
language sql stable set search_path='' as $$
 select w.* from public.work_cards w where w.company_id=c and public.can_see_agent(c,w.agent_id);
$$;
revoke all on function public.board_cards(uuid) from public,anon,authenticated,service_role;
grant execute on function public.board_cards(uuid) to authenticated;

-- The Company's Agents that worked on a Card: those with a row in the Company log for it, first logged first. Read as
-- the reader through PostgREST (select=*,crew), so the log's read rule leaves out an Agent hidden from them.
create function public.crew(card public.work_cards) returns uuid[]
language sql stable set search_path='' as $$
 select coalesce(array_agg(x.agent_id order by x.first_at,x.agent_id),'{}') from (
  select l.agent_id,min(l.created_at) first_at from public.company_log l
  join public.hermes_agents h on h.id=l.agent_id and h.company_id=l.company_id
  where l.company_id=card.company_id and l.card_id=card.id group by l.agent_id) x;
$$;
revoke all on function public.crew(public.work_cards) from public,anon,authenticated,service_role;
grant execute on function public.crew(public.work_cards) to authenticated;
