-- #384, ADR 0018 (Sign-in): the sign-in target lists every profile of the Company and no other Company's, and it lists
-- them in one order: the Company's own profile first, then its Agents' by name. The order was the planner's until here
-- (an Agent's profile sorts before the Company's), so a reader that compares or shows the list saw a different order on
-- a database that answered it from another plan. The profiles are the same set: this names no other Company's.
create or replace function public.company_engine_target(c uuid) returns table(profile text, profiles text[])
 language sql stable security definer set search_path='' as $function$
 -- `profile` is the Company's own profile, null before the worker makes it; the root profile is the Engine's and is
 -- never one of these. `profiles` is every profile of this Company and no other Company's, the Company's own first.
 select (select p.profile from public.company_profiles p where p.company_id=c),
  coalesce(array(select x.profile from (
    select p.profile, true as own from public.company_profiles p where p.company_id=c
    union all
    select a.profile, false from public.agent_profiles a where a.company_id=c) x order by x.own desc, x.profile),'{}'::text[])
 where public.is_member(c);
$function$;
