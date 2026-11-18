-- #345: the team's lasting rules (#18) live in a gtmworks section of each Agent's profile SOUL.md, which the Engine loads
-- in every session, instead of going with every Run. Who may give and remove a rule, its record and its log stay here
-- (agent_rules, hermes_agent_audit). The worker lists each Agent profile with its team's rules in force and writes the
-- section from that list (lib/agent-rules.mjs). No Run is told rules any more: a Run's pin and a channel or note Run's
-- row carry none. A Contributor's own suggestion, waiting or refused, reaches no Run until it is approved.
--
-- Nothing existing is rewritten. The previous app version runs against this: pin_run keeps its answer's shape, with no
-- rules, and the channel functions keep theirs.

-- 20261220000000's pin_run, unchanged but that a Run pins no rules. rules stays its mark of a Run this version pinned.
create or replace function public.pin_run(conversation uuid, message_key uuid, specs jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare held public.conversation_run_reservations; kept public.conversation_run_notes; offered text[];
begin
 select * into held from public.conversation_run_reservations r where r.conversation_id=conversation and r.send_key=message_key for update;
 select * into kept from public.conversation_run_notes n where n.conversation_id=conversation and n.send_key=message_key for update;
 if kept.conversation_id is null then return null; end if;
 if kept.rules is null and held.conversation_id is not null and held.start_attempts=0 and held.start_unknown_at is null then
  offered:=array(select t from unnest(public.run_tools(held.company_id,held.agent_id,held.person_id)) t where jsonb_typeof(specs->t)='string');
  update public.conversation_run_notes n set
   tools=case when cardinality(offered)>0 then '['||(select string_agg(specs->>t,',' order by o) from unnest(offered) with ordinality u(t,o))||']' end,
   rules='{}'
   where n.conversation_id=conversation and n.send_key=message_key returning * into kept;
 end if;
 return jsonb_build_object('tools',kept.tools,'rules','[]'::jsonb);
end $$;

-- The channel and note functions still name this when they make a Run's row: it answers no rules.
create or replace function public.agent_rules_in_force(agent uuid) returns text[] language sql stable security definer set search_path='' as $$
 select '{}'::text[];
$$;
-- The rules a person's Run was told: nothing calls it any more.
drop function if exists public.agent_rules_in_force(uuid,uuid);

-- The worker's list: each Agent with its own profile in the bundled Engine (an Agent's `ag-` profile once made, or for the
-- main Agent still on it, its Company's `co-` profile) and its team's rules in force, oldest first: told by an Owner or a
-- Manager, or approved, and not removed. A hundred at most, in an order that turns every minute.
create function public.agent_soul_rules_work() returns table(profile text, rules jsonb)
language sql stable security definer set search_path='' as $$
 select x.profile,coalesce((select jsonb_agg(r.body order by r.said_at,r.id) from public.agent_rules r
   where r.agent_id=x.id and r.removed_at is null and (r.suggestion is null or r.suggestion='approved')),'[]')
 from (select a.id,coalesce((select p.profile from public.agent_profiles p where p.agent_id=a.id and p.tools_level is not null),
   case when a.is_default then (select c.profile from public.company_profiles c where c.company_id=a.company_id) end) as profile
  from public.hermes_agents a) x
 where x.profile is not null
 order by md5(x.id::text||date_trunc('minute',now())::text)
 limit 100;
$$;
revoke all on function public.agent_soul_rules_work() from public,anon,authenticated;
grant execute on function public.agent_soul_rules_work() to service_role;
