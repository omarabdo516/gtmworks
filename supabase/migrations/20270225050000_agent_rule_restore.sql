-- #28: an Owner or a Manager brings back a rule they removed, from the rule's row in Learning. The rule is the same
-- row (it is never deleted): only removed_at and removed_by are cleared, so the worker writes it into the gtmworks
-- section of the Agent's SOUL.md again on its next pass (lib/agent-rules.mjs, agent_soul_rules_work), and the database
-- logs AGENT_RULE_RESTORED once, read as agent_rule_restored. The same checks as remove_agent_rule apply: an active
-- Owner or Manager of the rule's Company who sees that Agent. Only a rule that was in force is brought back: a
-- suggestion still waiting or refused was never in force, and its waiting item is gone.
--
-- Nothing existing is rewritten. The previous app version never calls restore_agent_rule, and its rules read the same.

create function public.restore_agent_rule(c uuid, rule uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare kept public.agent_rules;
begin
 select * into kept from public.agent_rules r where r.id=rule and r.company_id=c and r.agent_id is not null for update;
 if not found or not public.can_see_agent(c,kept.agent_id) then raise exception 'agentRuleNotFound' using errcode='P0002'; end if;
 if not public.may_tell_agent_rules(c,kept.agent_id,auth.uid()) then raise exception 'agentRuleNotAllowed' using errcode='42501'; end if;
 if kept.removed_at is null then return false; end if;
 if kept.suggestion is not null and kept.suggestion<>'approved' then return false; end if;
 update public.agent_rules set removed_at=null,removed_by=null where id=rule;
 perform public.log_agent_event(c,auth.uid(),(select name from public.people where id=auth.uid()),kept.agent_id,'AGENT_RULE_RESTORED',
  jsonb_build_object('rule',kept.body));
 return true;
end $$;
revoke all on function public.restore_agent_rule(uuid,uuid) from public,anon,service_role;
grant execute on function public.restore_agent_rule(uuid,uuid) to authenticated;
