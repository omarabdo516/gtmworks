-- #772 (spec #759, ADR 0031 point 4): the worker writes an Agent's rules into its profile's soul when the rules the
-- profile should hold differ from what it last wrote there, with a slow pass for drift, so it lists every profile with
-- its rules in force each pass (cheap: one read of the database) and asks the Engine only for those that changed. Every
-- profile is listed, however many there are: the list of the cutover took one hundred a pass, picked at random.
--
-- Additive (ADR 0023): one new function, the same rows as the cutover's list without its limit, in a stable order. The
-- previous release keeps calling its own list.
create function public.agent_soul_rules_all() returns table(company_id uuid, profile text, rules jsonb)
language sql stable security definer set search_path='' as $$
 select x.company_id,x.profile,coalesce((select jsonb_agg(r.body order by r.said_at,r.id) from public.agent_rules r
   where r.agent_id=x.id and r.removed_at is null and (r.suggestion is null or r.suggestion='approved')),'[]')
 from (select a.id,a.company_id,coalesce((select p.profile from public.agent_profiles p where p.agent_id=a.id and (p.tools_confirmed or p.tools_pending)),
   case when a.is_default then (select c.profile from public.company_profiles c where c.company_id=a.company_id) end) as profile
  from public.hermes_agents a) x
 where x.profile is not null
 order by x.company_id,x.profile;
$$;
revoke all on function public.agent_soul_rules_all() from public,anon,authenticated;
grant execute on function public.agent_soul_rules_all() to service_role;
