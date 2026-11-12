create function public.agent_identities() returns table(id uuid, role text, name text) language sql stable security definer set search_path='' as $$
 select a.id, a.role, p.name from public.agents a join public.people p on p.id=a.id where auth.uid() is not null;
$$;
revoke all on function public.agent_identities() from public, anon;
grant execute on function public.agent_identities() to authenticated;
