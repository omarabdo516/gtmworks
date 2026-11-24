-- #660: an Agent Lead makes starts on its own profile with the Company's Providers as they stand (spec #611): the root's
-- subscriptions, which every profile of the Company's Engine reads already, the API keys of its shared space, and the
-- model Lead runs on (lib/hermes.mjs giveProviders). Before, a Company holding a key (#299) made every such Agent wait in
-- "Waiting on you" for the Owner to give a key again, a step nothing told them of. An Agent now waits only while the
-- Company has no account that gives it a model, and its card opens Settings at Providers.
--
-- An Agent already waiting is released by the worker (lib/company-profiles.mjs releaseKeyWaits): agent_key_wait_work
-- lists each one whose profile the Engine made, in a Company that still counts as holding a key, with its space, Lead's
-- profile and the Company's change count; once the Engine says the profile answers, release_agent_key_wait ends the wait
-- unless a key change began or ended since that count, which may have written another value, so the next pass gives it
-- the Providers again. Nothing existing is changed: the previous app version never calls the two new functions, so its
-- Agents wait as before, and this version's worker releases them.

-- Each Agent waiting for a model on a profile the Engine made, in a Company that counts as holding a key: its profile,
-- the Company's space, the profile of its main Agent (Lead), and the Company's change count now.
create function public.agent_key_wait_work() returns table(company_id uuid, agent_id uuid, profile text, space text, keeper text, seen bigint)
language sql stable security definer set search_path='' as $$
 select w.company_id,w.agent_id,p.profile,s.profile,k.profile,
  (select coalesce(max(h.version),0) from public.company_key_holds h where h.company_id=w.company_id)
 from public.agent_key_waits w
 join public.agent_profiles p on p.agent_id=w.agent_id and p.company_id=w.company_id and p.tools_confirmed
 join public.company_shared_spaces s on s.company_id=w.company_id
 join public.hermes_agents k on k.company_id=w.company_id and k.is_default and k.profile is not null
 where public.company_holds_provider_key(w.company_id)
 order by w.id;
$$;
revoke all on function public.agent_key_wait_work() from public,anon,authenticated,service_role;
grant execute on function public.agent_key_wait_work() to service_role;

-- The Engine says the Agent's profile answers: its wait ends, under the lock key changes take, unless a change of the
-- Company's keys began or ended since `seen`, or one is still under way (it may have begun before `seen` was read).
-- True when a wait ended.
create function public.release_agent_key_wait(agent uuid, engine_profile text, seen bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes_agents',0));
 select p.company_id into c from public.agent_profiles p where p.agent_id=agent and p.profile=engine_profile;
 if not found or seen is null then return false; end if;
 if exists(select 1 from public.company_key_holds h where h.company_id=c and (h.version>seen or h.changing)) then return false; end if;
 delete from public.agent_key_waits w where w.agent_id=agent and w.company_id=c;
 return found;
end $$;
revoke all on function public.release_agent_key_wait(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.release_agent_key_wait(uuid,text,bigint) to service_role;
