alter table public.people add column theme text check (theme in ('light','dark','device'));
create function public.set_theme(chosen_theme text) returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 update public.people set theme=chosen_theme where id=auth.uid();
 if not found then raise exception 'person not found'; end if;
end $$;
revoke all on function public.set_theme(text) from public, anon;
grant execute on function public.set_theme(text) to authenticated;
