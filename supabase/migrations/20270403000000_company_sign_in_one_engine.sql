-- A Company's model sign-in is its own Engine's (#384, ADR 0018): an Owner signs a subscription in once on that
-- Engine's root profile, and the Engine gives it to every Agent profile of the Company with none of its own. The
-- database answers which profiles are the Company's, so a Disconnect also removes an older sign-in left in one of
-- them and in no other Company's. Nothing here tells one Company from several any more: whether the install has one
-- Company and the shared Engine warning's question go with the page that asked them. The sign-in target goes first:
-- its old body asks the Company count, so that function cannot be dropped before it.

drop function public.company_engine_target(uuid);
drop function public.install_has_one_company();
drop function public.bundled_engine_shared(uuid);

create function public.company_engine_target(c uuid) returns table(profile text, profiles text[])
 language sql stable security definer set search_path='' as $function$
 -- `profile` is the Company's own profile, null before the worker makes it; the root profile is the Engine's and is
 -- never one of these. `profiles` is every profile of this Company and no other Company's, the Company's own first.
 select (select p.profile from public.company_profiles p where p.company_id=c),
  coalesce(array(select x.profile from (
    select p.profile from public.company_profiles p where p.company_id=c
    union all
    select a.profile from public.agent_profiles a where a.company_id=c) x order by x.profile),'{}'::text[])
 where public.is_member(c);
$function$;
revoke all on function public.company_engine_target(uuid) from public,anon,service_role;
grant execute on function public.company_engine_target(uuid) to authenticated;
