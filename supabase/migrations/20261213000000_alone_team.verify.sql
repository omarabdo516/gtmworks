-- A second active Member turns an alone Company into a team, and a team with other Members cannot go back to alone;
-- neither trigger function is callable by any client role.
select json_build_object(
 'member_turns_team',exists(select 1 from pg_trigger where tgrelid='public.members'::regclass and tgname='member_turns_team' and not tgisinternal),
 'team_stays_team',exists(select 1 from pg_trigger where tgrelid='public.companies'::regclass and tgname='alone_mode_guard' and not tgisinternal),
 'raises_refusal',position('workModeTeamHasMembers' in pg_get_functiondef('public.guard_alone_mode()'::regprocedure))>0,
 'no_client_calls',not has_function_privilege('authenticated','public.member_turns_team()','execute')
  and not has_function_privilege('anon','public.member_turns_team()','execute')
  and not has_function_privilege('authenticated','public.guard_alone_mode()','execute')
  and not has_function_privilege('anon','public.guard_alone_mode()','execute')
);
